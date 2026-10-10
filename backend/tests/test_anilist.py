import unittest
from unittest.mock import patch
from pydantic import ValidationError
from app.schemas import Media, MediaReleaseDate
from app.services import anilist


def entry(number: int, relations: list[tuple[int, str]] | None = None) -> dict:
    return {'id': number, 'type': 'ANIME', 'title': {'romaji': 'Same title'},
            'episodes': 12, 'format': 'TV', 'startDate': {'year': 2020, 'month': None, 'day': None},
            'relations': {'edges': [{'relationType': kind, 'node': entry(other)} for other, kind in (relations or [])]}}


class MetadataTests(unittest.TestCase):
    def test_partial_dates_count_certainty_and_legacy_json(self):
        media = anilist.normalize(entry(1))
        self.assertEqual(media.release_date, MediaReleaseDate(year=2020))
        self.assertTrue(media.total_units_known)
        old = media.model_dump(exclude={'release_date', 'total_units_known'})
        self.assertFalse(Media.model_validate(old).total_units_known)
        self.assertIsNone(Media.model_validate(old).release_date)
        for count in (None, 0, -1):
            data = entry(1); data['episodes'] = count; data['startDate'] = {'year': None}
            unknown = anilist.normalize(data)
            self.assertEqual(unknown.total_units, 1)
            self.assertFalse(unknown.total_units_known)
            self.assertIsNone(unknown.release_date)
        manga = entry(2); manga.update(type='MANGA', chapters=50)
        self.assertEqual(anilist.normalize(manga).progress_unit, 'chapter')
        self.assertTrue(anilist.normalize(manga).total_units_known)
        prologue = anilist.normalize(entry(19603))
        self.assertTrue(prologue.has_prologue)
        self.assertEqual(prologue.total_units, 13)
        unknown = entry(19603); unknown['episodes'] = None
        self.assertEqual(anilist.normalize(unknown).total_units, 1)
        self.assertFalse(anilist.normalize(unknown).total_units_known)
        for raw in ({'year': 2023, 'month': 2, 'day': 29}, {'month': 13}, {'day': 0}):
            with self.assertRaises(ValidationError): MediaReleaseDate.model_validate(raw)

    def test_details_returns_selected_metadata_and_rejects_invalid_ids(self):
        with patch('app.services.anilist.query', return_value={'Media': entry(1)}):
            self.assertEqual(anilist.normalize(anilist.details('anilist-1')), anilist.normalize(entry(1)))
        for bad in ('x', 'anilist-x', 'anilist--1'):
            with self.assertRaises(ValueError): anilist.details(bad)


class DiscoveryTests(unittest.TestCase):
    def test_shuffled_provider_edges_have_same_bounded_admission(self):
        raw = entry(1, [(4, 'SEQUEL'), (3, 'ALTERNATIVE'), (2, 'PREQUEL'), (2, 'PREQUEL')])
        with patch('app.services.anilist.details', return_value=raw):
            one = anilist.discover('anilist-1', node_limit=3, depth_limit=0)
        raw['relations']['edges'].reverse()
        with patch('app.services.anilist.details', return_value=raw):
            two = anilist.discover('anilist-1', node_limit=3, depth_limit=0)
        self.assertEqual(one.graph, two.graph)
        self.assertEqual([m.id for m in one.graph.media], ['anilist-1', 'anilist-2', 'anilist-3'])
        self.assertEqual(len(one.graph.relationships), 2)
        self.assertIn('node_cap', one.limitations)
        self.assertTrue(one.graph.truncated)

    def test_cycles_reciprocals_unknown_edges_and_boundary_nodes(self):
        rows = {'anilist-1': entry(1, [(1, 'SEQUEL'), (2, 'SEQUEL'), (3, 'OTHER'), (4, 'FUTURE_TYPE')]),
                'anilist-2': entry(2, [(1, 'PREQUEL'), (1, 'SEQUEL')])}
        with patch('app.services.anilist.details', side_effect=lambda key: rows[key]) as details:
            result = anilist.discover('anilist-1', node_limit=10, depth_limit=2)
        self.assertEqual(details.call_count, 2)
        self.assertEqual(result.strong_ids, {'anilist-1', 'anilist-2'})
        self.assertEqual(result.frontier, set())
        self.assertEqual(len(result.graph.relationships), 6)
        ids = {m.id for m in result.graph.media}
        self.assertTrue(all(e.source in ids and e.target in ids for e in result.graph.relationships))
        self.assertIn('boundary_associations', result.limitations)
        # Matching titles have no effect on membership.
        self.assertNotIn('anilist-3', result.strong_ids)

    def test_cold_and_warm_expansion_resume_frontier_not_depth_exhausted_root(self):
        rows = {'anilist-1': entry(1, [(2, 'SEQUEL')]),
                'anilist-2': entry(2, [(1, 'PREQUEL'), (3, 'SEQUEL')]),
                'anilist-3': entry(3, [(2, 'PREQUEL')])}
        with patch('app.services.anilist.details', side_effect=lambda key: rows[key]) as details:
            cold = anilist.discover('anilist-1', depth_limit=0, node_limit=10)
            self.assertEqual(cold.expanded, {'anilist-1'})
            self.assertEqual(cold.frontier, {'anilist-2'})
            details.reset_mock()
            warm = anilist.discover('anilist-1', seed=cold.graph, expanded=cold.expanded,
                                    strong_ids=cold.strong_ids, frontier=cold.frontier,
                                    depth_limit=0, node_limit=10)
            self.assertEqual([call.args[0] for call in details.call_args_list], ['anilist-2'])
            self.assertEqual(warm.frontier, {'anilist-3'})
            details.reset_mock()
            done = anilist.discover('anilist-1', seed=warm.graph, expanded=warm.expanded,
                                    strong_ids=warm.strong_ids, frontier=warm.frontier,
                                    depth_limit=0, node_limit=10)
            self.assertEqual([call.args[0] for call in details.call_args_list], ['anilist-3'])
            self.assertEqual(done.frontier, set())
            self.assertEqual(len(done.graph.relationships), 4)
            self.assertEqual(done.observed_ids, {'anilist-3'})
            details.reset_mock()
            anilist.discover('anilist-1', seed=done.graph, expanded=done.expanded,
                             strong_ids=done.strong_ids, frontier=done.frontier)
            details.assert_not_called()

    def test_at_cap_frontier_fetch_retains_reciprocal_edges_without_new_admission(self):
        rows = {'anilist-1': entry(1, [(2, 'SEQUEL')]),
                'anilist-2': entry(2, [(1, 'PREQUEL'), (3, 'SEQUEL')])}
        with patch('app.services.anilist.details', side_effect=lambda key: rows[key]) as provider:
            cold = anilist.discover('anilist-1', node_limit=2, depth_limit=0)
            provider.reset_mock()
            warm = anilist.discover('anilist-1', seed=cold.graph, expanded=cold.expanded,
                                    strong_ids=cold.strong_ids, frontier=cold.frontier,
                                    node_limit=2, depth_limit=0)
        self.assertEqual([call.args[0] for call in provider.call_args_list], ['anilist-2'])
        self.assertEqual({m.id for m in warm.graph.media}, {'anilist-1', 'anilist-2'})
        self.assertEqual({(e.source, e.target, e.type) for e in warm.graph.relationships},
                         {('anilist-1', 'anilist-2', 'SEQUEL'), ('anilist-2', 'anilist-1', 'PREQUEL')})
        self.assertIn('node_cap', warm.limitations)

    def test_missing_or_mismatched_selected_media_fails(self):
        for raw in (None, entry(2)):
            with patch('app.services.anilist.details', return_value=raw), self.assertRaises((TypeError, ValueError)):
                anilist.discover('anilist-1')
