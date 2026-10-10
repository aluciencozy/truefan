from app.schemas import (Entity, FlowEdge, FlowGraphResponse, FlowItemData, FlowNode, FlowNodeData,
                         FlowPosition, GraphResponse, Relationship, RevealPoint)


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


def to_flow_graph(graph: GraphResponse, origin: str) -> FlowGraphResponse:
    """Reshape an already-filtered graph into React Flow's nodes/edges. No reveal logic here."""
    nodes = [FlowNode(id=entity.id, position=FlowPosition(x=(i % 4) * 240, y=(i // 4) * 200 + (i % 2) * 65),
                      data=FlowNodeData(label=entity.name, entity_type=entity.type,
                                        description=entity.description, revealed_at=entity.revealed_at,
                                        provenance=entity.provenance))
             for i, entity in enumerate(graph.entities)]
    edges = [FlowEdge(id=edge.id, source=edge.source, target=edge.target, label=edge.type,
                      data=FlowItemData(revealed_at=edge.revealed_at, provenance=edge.provenance))
             for edge in graph.relationships]
    return FlowGraphResponse(media_id=graph.media_id, progress=graph.progress, origin=origin,
                             nodes=nodes, edges=edges)
