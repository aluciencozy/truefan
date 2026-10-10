from app.schemas import Entity, Media, Provenance, Relationship, RevealPoint

# Fictional fixture; no real-series spoilers or external services required.
MEDIA = Media(
    id="lantern-harbor", title="Lantern Harbor", type="anime",
    progress_unit="episode", total_units=3, total_units_known=True,
    description="A fictional three-episode mystery about a missing harbor light.",
)


def entity(id: str, name: str, type: str, description: str, unit: int) -> Entity:
    return Entity(id=id, name=name, type=type, description=description,
                  revealed_at=RevealPoint(unit=unit),
                  provenance=Provenance(source="Manually curated demo", source_unit=unit, verified=True))


def relationship(id: str, source: str, target: str, type: str, unit: int) -> Relationship:
    return Relationship(id=id, source=source, target=target, type=type,
                        revealed_at=RevealPoint(unit=unit),
                        provenance=Provenance(source="Manually curated demo", source_unit=unit, verified=True))


ENTITIES = [
    entity("mira", "Mira", "character", "A young cartographer visiting the harbor.", 1),
    entity("sol", "Sol", "character", "Mira’s friend and a local boat builder.", 1),
    entity("harbor", "Lantern Harbor", "location", "A coastal town known for its lighthouse.", 1),
    entity("keepers", "Lightkeepers", "faction", "The crew maintaining the harbor lights.", 2),
    entity("compass", "Glass compass", "object", "A compass found in the lighthouse workshop.", 3),
]
RELATIONSHIPS = [
    relationship("friends", "mira", "sol", "friend", 1),
    relationship("visits", "mira", "harbor", "visits", 1),
    relationship("maintains", "keepers", "harbor", "maintains", 2),
    relationship("joins", "sol", "keepers", "member", 2),
    relationship("finds", "mira", "compass", "finds", 3),
]
