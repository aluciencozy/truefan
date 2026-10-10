import unittest
from types import SimpleNamespace
from unittest.mock import patch
from app.schemas import Media
from app.services import anilist, universe_search
from test_anilist import entry


def media(number: int, title: str) -> Media:
    return anilist.normalize({**entry(number), 'title': {'english': title, 'romaji': title}})


def row(franchise: str, name: str, work: Media) -> dict[str, object]:
    return {'id': franchise, 'display_name': name, 'media': work.model_dump()}


class UniverseSearchTests(unittest.TestCase):
    def setUp(self):
        self.connection = self.enterContext(patch('app.services.universe_search.connection'))
        self.cursor = self.connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        self.zero = media(10087, 'Fate/Zero')
        self.ubw = media(19603, 'Fate/stay night: Unlimited Blade Works')
        self.fate_rows = [row('fate', self.ubw.title, work) for work in (self.ubw, self.zero)]

    def test_cached_franchises_deduplicate_and_preserve_exact_title_entry(self):
        self.cursor.execute.return_value.fetchall.return_value = self.fate_rows + [
            row('apothecary', 'The Apothecary Diaries', media(161645, 'The Apothecary Diaries')),
            row('apothecary', 'The Apothecary Diaries', media(176301, 'The Apothecary Diaries Season 2')),
        ]
        with patch('app.services.anilist.search_media') as provider, patch('app.services.franchises.universe') as discover:
            fate = universe_search.search('Fate')
            exact = universe_search.search('Fate/Zero', discover=True)
            other = universe_search.search('The Apothecary Diaries Season 2')
        self.assertEqual([item.title for item in fate.results], ['Fate Universe'])
        self.assertTrue(fate.auto_open)
        self.assertEqual(exact.results[0].franchise_id, fate.results[0].franchise_id)
        self.assertEqual(exact.results[0].entry_media_id, self.zero.id)
        self.assertEqual([item.title for item in other.results], ['The Apothecary Diaries Universe'])
        self.assertEqual(other.results[0].entry_media_id, 'anilist-176301')
        provider.assert_not_called(); discover.assert_not_called()
        sql = self.cursor.execute.call_args.args[0]
        self.assertIn("f.merged_into IS NULL", sql)
        self.assertIn("(f.discovery->'strong_ids') ? m.media_id", sql)

    def test_discovery_only_on_enter_and_skips_newly_recognized_members(self):
        self.cursor.execute.return_value.fetchall.side_effect = [[], [], self.fate_rows]
        with patch('app.services.anilist.search_media', return_value=[self.ubw, self.zero]) as provider, \
             patch('app.services.franchises.load', side_effect=[None, object()]), \
             patch('app.services.franchises.universe', return_value=SimpleNamespace(franchise_id='fate')) as discover:
            self.assertEqual(universe_search.search('Fate').results, [])
            provider.assert_not_called(); discover.assert_not_called()
            result = universe_search.search('Fate', discover=True)
        discover.assert_called_once_with(self.zero.id)
        self.assertTrue(result.auto_open)
        self.assertEqual(len(result.results), 1)

    def test_unrelated_franchises_are_choices_even_with_the_same_label(self):
        self.cursor.execute.return_value.fetchall.return_value = self.fate_rows + [
            row('unrelated', 'Fate/Rewinder', media(195787, 'Fate/Rewinder')),
        ]
        result = universe_search.search('Fate', discover=True)
        self.assertEqual(len(result.results), 2)
        self.assertFalse(result.auto_open)
        self.assertEqual({item.franchise_id for item in result.results}, {'fate', 'unrelated'})

    def test_unresolved_candidates_at_discovery_limit_do_not_auto_open(self):
        candidates = [media(number, f'Story {number}') for number in range(1, 5)]
        self.cursor.execute.return_value.fetchall.side_effect = [[], [row('story', 'Story', candidates[0])]]
        with patch('app.services.anilist.search_media', return_value=candidates), \
             patch('app.services.franchises.load', return_value=None), \
             patch('app.services.franchises.universe', return_value=SimpleNamespace(franchise_id='story')) as discover:
            result = universe_search.search('Story', discover=True)
        self.assertEqual(discover.call_count, 3)
        self.assertFalse(result.auto_open)
