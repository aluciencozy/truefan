from app.schemas import Entity, GraphResponse, Relationship, RevealPoint


def is_revealed(reveal: RevealPoint, progress: RevealPoint) -> bool:
    return reveal.unit <= progress.unit


def filter_graph(media_id: str, progress: RevealPoint, entities: list[Entity],
                 relationships: list[Relationship]) -> GraphResponse:
    visible = [entity for entity in entities if is_revealed(entity.revealed_at, progress)]
    # Episode snapshots: choose the latest visible description, never a future one.
    by_id = {}
    for entity in sorted(visible, key=lambda e: e.revealed_at.unit):
        by_id[entity.id] = entity
    visible = list(by_id.values())
    ids = {entity.id for entity in visible}
    edges = [edge for edge in relationships
             if is_revealed(edge.revealed_at, progress)
             and edge.source in ids and edge.target in ids]
    return GraphResponse(media_id=media_id, progress=progress,
                         entities=visible, relationships=edges)
