import copy
import unittest
from app.schemas import RevealPoint
from app.services import curation, generation
from app.services.graph import filter_graph


class CurationTests(unittest.TestCase):
    def test_replacements_use_filtered_graph_contract(self):
        for replacement in curation.load().graphs:
            entities, edges = generation.graph_data(replacement.document())
            self.assertEqual(filter_graph(replacement.media_id, RevealPoint(unit=0), entities, edges).entities, [])
            for unit in range(1, len(replacement.episodes) + 1):
                graph = filter_graph(replacement.media_id, RevealPoint(unit=unit), entities, edges)
                ids = {e.id for e in graph.entities}
                self.assertTrue(ids)
                for item in [*graph.entities, *graph.relationships]:
                    self.assertLessEqual(item.revealed_at.unit, unit)
                    self.assertFalse(item.provenance.verified)
                    self.assertEqual(item.provenance.model, curation.MODEL)
                for edge in graph.relationships:
                    self.assertIn(edge.source, ids)
                    self.assertIn(edge.target, ids)

    def test_later_name_keeps_identity_and_earlier_relationships(self):
        replacement = next(g for g in curation.load().graphs if g.media_id == 'anilist-98035')
        entities, edges = generation.graph_data(replacement.document())
        early = filter_graph(replacement.media_id, RevealPoint(unit=3), entities, edges)
        late = filter_graph(replacement.media_id, RevealPoint(unit=5), entities, edges)
        original = next(e for e in early.entities if e.name == 'Escaped homunculus')
        named = next(e for e in late.entities if e.name == 'Sieg')
        self.assertEqual(original.id, named.id)
        self.assertNotIn('Sieg', [e.name for e in early.entities])
        self.assertNotIn('Escaped homunculus', [e.name for e in late.entities])
        attached = [e.id for e in early.relationships if original.id in (e.source, e.target)]
        self.assertTrue(attached)
        self.assertTrue(set(attached) <= {e.id for e in late.relationships})

    def test_future_endpoint_and_wrong_revision_abort(self):
        replacement = copy.deepcopy(curation.load().graphs[0])
        replacement.episodes[0].relationships[0].target = 'Future character'
        with self.assertRaises(ValueError):
            replacement.document()
        replacement = copy.deepcopy(curation.load().graphs[0])
        replacement.episodes[0].source_revision += 1
        with self.assertRaises(ValueError):
            replacement.document()
