from app.schemas import Entity, Media, Provenance, Relationship, RevealPoint
from app.services import demo

# Hand-written seed data. Reveal episodes were NOT checked against the episodes by a person:
# where unsure they are set later rather than earlier (a late reveal hides a fact; an early one
# spoils it). Rows are therefore marked verified=False until someone reviews them.
SOURCE = "Hackathon seed (unreviewed)"

AOT = Media(
    id="attack-on-titan", title="Attack on Titan", type="anime", progress_unit="episode",
    total_units=25, anilist_id=16498,
    description="Season 1: humanity lives behind enormous walls to survive man-eating Titans.",
)


def ent(id: str, name: str, type: str, description: str, unit: int) -> Entity:
    return Entity(id=id, name=name, type=type, description=description,
                  revealed_at=RevealPoint(unit=unit),
                  provenance=Provenance(source=SOURCE, source_unit=unit, verified=False))


def rel(id: str, source: str, target: str, type: str, unit: int) -> Relationship:
    return Relationship(id=id, source=source, target=target, type=type,
                        revealed_at=RevealPoint(unit=unit),
                        provenance=Provenance(source=SOURCE, source_unit=unit, verified=False))


AOT_ENTITIES = [
    # Tier 1
    ent("eren", "Eren Yeager", "character", "A boy from Shiganshina District who dreams of joining the Survey Corps.", 1),
    ent("mikasa", "Mikasa Ackerman", "character", "Eren's childhood friend and a gifted fighter.", 1),
    ent("armin", "Armin Arlert", "character", "Eren's close friend, a bookish dreamer curious about the world beyond the walls.", 1),
    ent("carla", "Carla Yeager", "character", "Eren's mother.", 1),
    ent("hannes", "Hannes", "character", "A soldier stationed in Shiganshina District.", 1),
    ent("colossal", "Colossal Titan", "character", "A giant Titan that appears above the outer wall of Shiganshina District.", 1),
    ent("titans", "Titans", "faction", "Giant humanoid creatures that devour humans.", 1),
    ent("wall_maria", "Wall Maria", "location", "The outermost of the great walls protecting humanity.", 1),
    ent("shiganshina", "Shiganshina District", "location", "A town at the edge of Wall Maria and Eren's home.", 1),
    ent("survey", "Survey Corps", "faction", "The military branch that ventures beyond the walls to explore and fight Titans.", 1),
    # Tier 5
    ent("garrison", "Garrison Regiment", "faction", "The military branch that guards the walls.", 5),
    ent("training", "Training Corps", "faction", "The academy that trains young recruits for military service.", 5),
    ent("keith", "Keith Shadis", "character", "The stern instructor of the Training Corps.", 5),
    ent("jean", "Jean Kirstein", "character", "A blunt, ambitious cadet.", 5),
    ent("marco", "Marco Bodt", "character", "A kind, dependable cadet and Jean's friend.", 5),
    ent("sasha", "Sasha Blouse", "character", "A cadet famous for her appetite.", 5),
    ent("connie", "Connie Springer", "character", "A cheerful cadet and Sasha's friend.", 5),
    ent("reiner", "Reiner Braun", "character", "A sturdy, reliable cadet.", 5),
    ent("bertholdt", "Bertholdt Hoover", "character", "A tall, quiet cadet and Reiner's friend.", 5),
    ent("annie", "Annie Leonhart", "character", "A skilled, reserved cadet.", 5),
    # Tier 10
    ent("pixis", "Dot Pixis", "character", "The eccentric commander of the Garrison Regiment.", 10),
    # Tier 15
    ent("levi", "Levi", "character", "An elite Survey Corps soldier.", 15),
    ent("erwin", "Erwin Smith", "character", "The commander of the Survey Corps.", 15),
    # Tier 20
    ent("hange", "Hange Zoë", "character", "A Survey Corps squad leader obsessed with studying Titans.", 20),
    ent("female", "Female Titan", "character", "A Titan with unusual intelligence and combat skill.", 20),
]
AOT_RELATIONSHIPS = [
    # Tier 1
    rel("eren-mikasa", "eren", "mikasa", "friend", 1),
    rel("eren-armin", "eren", "armin", "friend", 1),
    rel("carla-eren", "carla", "eren", "parent of", 1),
    rel("colossal-shiganshina", "colossal", "shiganshina", "attacks", 1),
    rel("colossal-titans", "colossal", "titans", "is a", 1),
    rel("shiganshina-wall", "shiganshina", "wall_maria", "protected by", 1),
    rel("hannes-shiganshina", "hannes", "shiganshina", "stationed in", 1),
    rel("eren-survey", "eren", "survey", "admires", 1),
    rel("survey-titans", "survey", "titans", "fights", 1),
    # Tier 5
    rel("hannes-garrison", "hannes", "garrison", "member of", 5),
    rel("keith-training", "keith", "training", "instructs", 5),
    rel("eren-training", "eren", "training", "member of", 5),
    rel("mikasa-training", "mikasa", "training", "member of", 5),
    rel("armin-training", "armin", "training", "member of", 5),
    rel("jean-training", "jean", "training", "member of", 5),
    rel("jean-marco", "jean", "marco", "friend", 5),
    rel("sasha-connie", "sasha", "connie", "friend", 5),
    rel("reiner-bertholdt", "reiner", "bertholdt", "friend", 5),
    # Tier 10
    rel("pixis-garrison", "pixis", "garrison", "commands", 10),
    # Tier 15
    rel("erwin-survey", "erwin", "survey", "commands", 15),
    rel("levi-survey", "levi", "survey", "member of", 15),
    # Tier 20
    rel("hange-survey", "hange", "survey", "member of", 20),
    rel("female-survey", "female", "survey", "attacks", 20),
    # Tier 25
    rel("annie-female", "annie", "female", "transforms into", 25),
]

# (media, entities, relationships) tuples shared by the seed script and the built-in fallback.
SEED = [
    (demo.MEDIA, demo.ENTITIES, demo.RELATIONSHIPS),
    (AOT, AOT_ENTITIES, AOT_RELATIONSHIPS),
]


def validate(media: Media, entities: list[Entity], relationships: list[Relationship]) -> None:
    """Fail fast on dangling endpoints, duplicate ids, or an edge revealed before its endpoints."""
    units = {entity.id: entity.revealed_at.unit for entity in entities}
    if len(units) != len(entities) or len({r.id for r in relationships}) != len(relationships):
        raise ValueError(f"{media.id}: duplicate entity or relationship id")
    for item in [*entities, *relationships]:
        if item.revealed_at.unit > media.total_units:
            raise ValueError(f"{media.id}/{item.id}: reveal point beyond total_units")
    for edge in relationships:
        if edge.source not in units or edge.target not in units:
            raise ValueError(f"{media.id}/{edge.id}: unknown endpoint")
        if edge.revealed_at.unit < max(units[edge.source], units[edge.target]):
            raise ValueError(f"{media.id}/{edge.id}: revealed before an endpoint")
