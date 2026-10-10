import json
import unittest
from pydantic import ValidationError
from scripts.hf_extraction_feasibility import validate_output

class ExtractionTests(unittest.TestCase):
    def sample(self):
        return {'episode_key': 'episode-1', 'entities': [
            {'name': name, 'kind': 'character', 'description': 'Appears in this interaction.', 'evidence': 'Ada rescues Ben.'}
            for name in ['Ada', 'Ben']], 'relationships': [
            {'source': 'Ada', 'target': 'Ben', 'type': 'rescues', 'label': 'Rescues', 'evidence': 'Ada rescues Ben.'}]}

    def test_grounded_candidate_is_not_verified(self):
        out = validate_output(json.dumps(self.sample()), 'Ada rescues Ben.', 'episode-1')
        self.assertEqual(len(out['relationships']), 1)
        self.assertFalse(out['verified'])
        self.assertIsNone(out['confirmed_spoiler_safe_reveal'])

    def test_unknown_character_and_dependent_edge_rejected(self):
        data = self.sample()
        data['entities'][1]['name'] = 'Beth'
        data['relationships'][0]['target'] = 'Beth'
        out = validate_output(json.dumps(data), 'Ada rescues Ben.', 'episode-1')
        self.assertEqual(len(out['rejected']), 2)
        self.assertEqual(out['relationships'], [])

    def test_fabricated_quote_rejected(self):
        data = self.sample()
        data['relationships'][0]['evidence'] = 'Ada and Ben are siblings.'
        out = validate_output(json.dumps(data), 'Ada rescues Ben.', 'episode-1')
        self.assertEqual(out['relationships'], [])

    def test_schema_and_episode_rejections(self):
        for mutation in [lambda d: d.update(extra=True), lambda d: d['relationships'][0].update(type='married'),
                         lambda d: d['entities'][0].update(description='First sentence. Second sentence.')]:
            data = self.sample()
            mutation(data)
            with self.assertRaises(ValidationError):
                validate_output(json.dumps(data), 'Ada rescues Ben.', 'episode-1')
        with self.assertRaises(ValueError):
            validate_output(json.dumps(self.sample()), 'Ada rescues Ben.', 'episode-2')

    def test_self_edge_rejected(self):
        data = self.sample()
        data['relationships'][0]['target'] = 'Ada'
        self.assertEqual(validate_output(json.dumps(data), 'Ada rescues Ben.', 'episode-1')['relationships'], [])

    def test_invalid_json_and_empty_extraction(self):
        with self.assertRaises(ValidationError):
            validate_output('not JSON', 'Ada rescues Ben.', 'episode-1')
        data = {'episode_key': 'episode-1', 'entities': [], 'relationships': []}
        self.assertEqual(validate_output(json.dumps(data), 'No names.', 'episode-1')['relationships'], [])
