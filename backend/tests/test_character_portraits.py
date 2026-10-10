import asyncio
import unittest
from unittest.mock import patch

from app.schemas import Entity, Media, Provenance, RevealPoint
from app.services import anilist
from app.services.graph import filter_graph
from test_franchises import request


def profile(number: int, name: str, aliases: list[str] | None = None) -> dict:
    return {'id': number, 'name': {'full': name, 'first': name.split()[0], 'alternative': aliases or []},
            'image': {size: f'https://s4.anilist.co/file/anilistcdn/character/{size}/{number}.jpg'
                      for size in ('medium', 'large')}}


def entity(name: str, unit: int = 1, kind: str = 'character') -> Entity:
    return Entity(id=name, name=name, type=kind, description='Known episode fact.',
                  revealed_at=RevealPoint(unit=unit), provenance=Provenance(source='Test', source_unit=unit))


class CharacterPortraitTests(unittest.TestCase):
    def test_normalized_aliases_and_ambiguous_names(self):
        profiles = [profile(497, 'Artoria Pendragon', ['Saber (セイバー)']),
                    profile(498, 'Rin Toosaka', ['Rin Tohsaka']),
                    profile(499, 'Cú Chulainn', ['Lancer']),
                    profile(2087, 'Archer'), profile(2514, 'Gilgamesh', ['Archer'])]
        names = ['Saber', ' TOHSAKA, Rin ', 'Cu Chulainn', 'Rin', 'Archer', 'Sabr']
        nodes = [entity(name) for name in names] + [entity('Saber', kind='object')]
        # Give the object its own ID so it does not replace the character snapshot.
        nodes[-1].id = 'object'
        graph = filter_graph('anilist-19603', RevealPoint(unit=1), nodes, [])
        with patch.object(anilist, 'character_profiles', return_value=profiles):
            enriched = anilist.character_portraits(graph, 19603)
        self.assertEqual([node.name for node in enriched.entities], [node.name for node in graph.entities])
        for index, number in enumerate((497, 498, 499, 498)):
            self.assertTrue(enriched.entities[index].portrait_url.endswith(f'/{number}.jpg'))
            self.assertIn('/large/', enriched.entities[index].portrait_large_url)
        for node in enriched.entities[4:]:
            self.assertIsNone(node.portrait_url)
        self.assertTrue(all(node.portrait_url is None for node in graph.entities))
        self.assertNotIn('Artoria Pendragon', enriched.model_dump_json())

    def test_cache_batches_paginated_cast_per_anime(self):
        pages = [{'data': {'Media': {'characters': {'nodes': [profile(i, f'Character {i}')],
                  'pageInfo': {'hasNextPage': i == 1}}}}} for i in (1, 2)]
        with patch.object(anilist, '_cache', anilist.OrderedDict()), patch.object(anilist, 'fetch', side_effect=pages) as fetch:
            for _ in range(2):
                self.assertEqual(len(anilist.character_profiles(19603)), 2)
            self.assertEqual(fetch.call_count, 2)
            query = fetch.call_args.args[1]['query']
            self.assertNotIn('alternativeSpoiler', query)
            self.assertNotIn('description', query)

    def test_optional_metadata_failure_and_no_cast_requests_for_empty_graph(self):
        graph = filter_graph('anime', RevealPoint(unit=1), [entity('Saber')], [])
        with patch.object(anilist, 'character_profiles', side_effect=ValueError('offline')) as provider:
            self.assertIs(anilist.character_portraits(graph, 19603), graph)
            provider.reset_mock()
            self.assertIs(anilist.character_portraits(graph, None), graph)
            empty = filter_graph('anime', RevealPoint(unit=0), [entity('Saber')], [])
            self.assertIs(anilist.character_portraits(empty, 19603), empty)
            provider.assert_not_called()

    def test_graph_api_never_exposes_future_cast_or_aliases(self):
        media = Media(id='anilist-19603', title='Fate', type='anime', progress_unit='episode',
                      total_units=13, anilist_id=19603, description='')
        nodes = [entity('Saber', 1), entity('Rin', 2)]
        profiles = [profile(497, 'Artoria Pendragon', ['Saber (セイバー)']), profile(498, 'Rin Toosaka'),
                    profile(999, 'Never Revealed')]
        with patch('app.main.get_media', return_value=media), patch('app.main.cached_generation', return_value={'document': {}}), \
             patch('app.services.generation.status', return_value=None), \
             patch('app.services.generation.graph_data', return_value=(nodes, [])), \
             patch.object(anilist, 'character_profiles', return_value=profiles):
            for unit, expected in ((0, []), (1, ['Saber']), (2, ['Saber', 'Rin']), (1, ['Saber'])):
                code, data = asyncio.run(request(f'/api/media/{media.id}/graph?progress={unit}'))
                self.assertEqual(code, 200)
                self.assertEqual([node['name'] for node in data['entities']], expected)
                self.assertTrue(all(node['portrait_url'] for node in data['entities']))
                self.assertNotIn('Artoria', str(data))
                self.assertNotIn('Never Revealed', str(data))
                self.assertNotIn('/999.jpg', str(data))
                if unit < 2:
                    self.assertNotIn('/498.jpg', str(data))
