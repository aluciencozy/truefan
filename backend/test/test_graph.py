import unittest
from app.schemas import RevealPoint
from app.services.demo import ENTITIES, MEDIA, RELATIONSHIPS
from app.services.graph import filter_graph, is_revealed


class GraphTests(unittest.TestCase):
    def test_progress_boundaries_and_endpoint_integrity(self):
        for unit, count in [(0, 0), (1, 3), (2, 4), (3, 5)]:
            graph = filter_graph(MEDIA.id, RevealPoint(unit=unit), ENTITIES, RELATIONSHIPS)
            self.assertEqual(len(graph.entities), count)
            ids = {entity.id for entity in graph.entities}
            for edge in graph.relationships:
                self.assertLessEqual(edge.revealed_at.unit, unit)
                self.assertIn(edge.source, ids)
                self.assertIn(edge.target, ids)
        self.assertTrue(is_revealed(RevealPoint(unit=2), RevealPoint(unit=2)))
        self.assertFalse(is_revealed(RevealPoint(unit=3), RevealPoint(unit=2)))

    def test_visible_edge_cannot_expose_hidden_endpoint(self):
        edge = RELATIONSHIPS[-1].model_copy(update={"revealed_at": RevealPoint(unit=1)})
        graph = filter_graph(MEDIA.id, RevealPoint(unit=1), ENTITIES, [edge])
        self.assertEqual(graph.relationships, [])


if __name__ == "__main__":
    unittest.main()
