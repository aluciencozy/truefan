import asyncio
import unittest
from unittest.mock import patch

from app.config import settings
from app.main import app
from app.services import anilist
from test_franchises import request


class TrendingCoverTests(unittest.TestCase):
    def test_public_endpoint_returns_only_safe_covers_in_trending_order_and_reuses_cache(self):
        first = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/2.jpg'
        second = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/1.jpg'
        rows = [{'id': 2, 'coverImage': {'medium': first}, 'title': 'Future title', 'description': 'Future plot'},
                {'id': 3, 'coverImage': None},
                {'id': 4, 'coverImage': {'medium': 'http://s4.anilist.co/insecure.jpg'}},
                {'id': 5, 'coverImage': {'medium': 'https://s4.anilist.co.evil.test/cover.jpg'}},
                {'id': 1, 'coverImage': {'medium': second}}]
        with patch.object(settings, 'database_url', ''), \
             patch.object(anilist, '_cache', anilist.OrderedDict()), \
             patch.object(anilist, 'fetch', return_value={'data': {'Page': {'media': rows}}}) as fetch:
            for _ in range(2):
                status, body = asyncio.run(request('/api/media/trending'))
                self.assertEqual(status, 200)
                self.assertEqual(body, [{'id': 2, 'cover_url': first}, {'id': 1, 'cover_url': second}])
            fetch.assert_called_once()
            query = fetch.call_args.args[1]['query']
            for fragment in ('perPage:16', 'type:ANIME', 'isAdult:false', 'sort:TRENDING_DESC', 'coverImage{medium}'):
                self.assertIn(fragment, query)
            self.assertNotIn('title', query)
            self.assertNotIn('description', query)
        operation = app.openapi()['paths']['/api/media/trending']['get']
        self.assertEqual(operation['responses']['200']['content']['application/json']['schema']['items']['$ref'],
                         '#/components/schemas/TrendingCover')

    def test_provider_failures_and_malformed_payloads_return_502(self):
        for error in (ValueError('offline'), KeyError('Page'), TypeError('bad payload')):
            with patch.object(anilist, 'query', side_effect=error):
                status, body = asyncio.run(request('/api/media/trending'))
            self.assertEqual(status, 502)
            self.assertEqual(body['detail'], 'AniList trending covers unavailable; try again shortly')

    def test_empty_provider_results_are_allowed(self):
        with patch.object(anilist, 'query', return_value={'Page': {'media': []}}):
            status, body = asyncio.run(request('/api/media/trending'))
        self.assertEqual((status, body), (200, []))
