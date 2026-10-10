"""Initialize only the additive community tables; optional clearly labeled demo posts."""
import argparse
from pathlib import Path
from uuid import UUID

from app.database import connection

EXAMPLES = [
 ('00000000-0000-4000-8000-000000000001', 'Mika Chen', "Kiki’s Delivery Service", 'Which anime world would you call home?',
  "The bakery in Kiki’s Delivery Service has my heart. A cozy room, fresh bread, and a little magic. What’s your pick — and what would your everyday life look like there?"),
 ('00000000-0000-4000-8000-000000000002', 'OrbitOliver', 'Attack on Titan', 'An anime soundtrack that feels like floating through space',
  'Revisited the Attack on Titan soundtrack today and somehow it still gives me goosebumps. Which anime opening or ending instantly takes you somewhere else? Building a playlist from your answers.'),
 ('00000000-0000-4000-8000-000000000003', 'Luna Reads', 'Natsume’s Book of Friends', 'Tell me your anime comfort-watch ritual ✦',
  'Rain outside, a giant mug of tea, and Natsume’s Book of Friends on repeat. No better way to spend a Sunday. What are the little rituals that make your favorite anime feel like home?'),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed-demo', action='store_true')
    args = parser.parse_args()
    with connection() as conn:
        conn.execute(Path(__file__).with_name('community_schema.sql').read_text())
        if args.seed_demo:
            for index, (post_id,author,media,title,body) in enumerate(EXAMPLES):
                conn.execute("""INSERT INTO public.community_posts(id,user_id,author,category,media,title,body,example,created_at)
                             VALUES (%s,'demo','discussion',%s,%s,%s,%s,true,now() - (%s * interval '20 minutes'))
                             ON CONFLICT DO NOTHING""", (UUID(post_id),author,media,title,body,index + 1))
    print('Community tables ready. Demo posts, if requested, have zero fabricated likes, comments, or visitors.')


if __name__ == '__main__':
    main()
