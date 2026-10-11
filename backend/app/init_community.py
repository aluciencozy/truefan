"""Initialize only the additive community tables; optional clearly labeled demo posts."""
import argparse
from pathlib import Path
from uuid import UUID

from app.database import connection

EXAMPLES = [{'id': 'courtroom', 'category': 'discussion', 'title': 'Charlotte courtroom: put a character’s choice on trial', 'prompt': 'Choose a decision from the episodes you have watched. Explain the case without revealing future events. Fans can join prosecution or defense and cite their evidence.'}, {'id': 'fanfiction', 'category': 'discussion', 'title': 'Charlotte: write a new day at Hoshinoumi Academy', 'prompt': 'Imagine an ordinary school day in the world of Charlotte. Write a scene in your own voice and invite others to continue it.'}, {'id': 'drawing', 'category': 'discussion', 'title': 'Charlotte drawing challenge: your favorite character', 'prompt': 'Draw a character in your own style. Share a sketch or a finished piece and tell us what inspired it. Keep future story details marked as spoilers.'}, {'id': 'battle', 'category': 'theory', 'title': 'Charlotte theory battle: what explains the mystery?', 'prompt': 'Set out two competing explanations based on the episodes you have watched. Give each side a name, then invite fans to contribute clues.'}, {'id': 'capsule', 'category': 'theory', 'title': 'Charlotte: predict the next episode', 'prompt': 'Before watching your next episode, write a prediction. Lock it when you are ready. After watching, reveal it and compare what happened.'}, {'id': 'ending', 'category': 'theory', 'title': 'Charlotte: change one decision—what happens next?', 'prompt': 'Pick one decision from an episode you have watched and write an alternate outcome. Explain why it fits the characters. Mark any plot details as spoilers.'}, {'id': 'mystery', 'category': 'theory', 'title': 'Charlotte detective board: connect the clues', 'prompt': 'Pin a clue with its episode reference. Connect it to another clue and explain the link. Use only material within this thread’s story scope.'}, {'id': 'pitch', 'category': 'review', 'title': 'Convince me to watch Charlotte in three sentences', 'prompt': 'Sell the mood, characters, or style of Charlotte in no more than three spoiler-free sentences.'}, {'id': 'verdict', 'category': 'review', 'title': 'Charlotte: how did your first impression change?', 'prompt': 'Record your first impression with the episode you have reached. Return later and add a final verdict. Mark finished-series details as spoilers.'}, {'id': 'hot-take', 'category': 'review', 'title': 'Charlotte hot take: the characters make the show', 'prompt': 'Make a case for or against this take. Add scene evidence from the episodes you have watched and let the community vote.'}, {'id': 'matchmaking', 'category': 'review', 'title': 'What should I watch alongside Charlotte?', 'prompt': 'Tell fans what mood, characters, or themes you want. Nominate a show and explain your pick without spoilers. The requester can mark recommendations they tried.'}]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed-demo', action='store_true')
    args = parser.parse_args()
    with connection() as conn:
        conn.execute(Path(__file__).with_name('community_schema.sql').read_text())
        if args.seed_demo:
            for index, example in enumerate(EXAMPLES):
                conn.execute("""INSERT INTO public.community_posts(id,user_id,author,category,media,title,body,example,room,side_a,side_b)
                             VALUES (%s,'demo','TrueFan starter topic',%s,'Charlotte',%s,%s,true,%s,%s,%s)
                             ON CONFLICT DO NOTHING""",
                             (UUID(f'00000000-0000-4000-8000-{index+100:012d}'),example['category'],example['title'],example['prompt'],example['id'],
                              'Theory A' if example['id']=='battle' else 'For' if example['id']=='hot-take' else 'Prosecution',
                              'Theory B' if example['id']=='battle' else 'Against' if example['id']=='hot-take' else 'Defense'))
    print('Community tables ready. Demo posts, if requested, have zero fabricated likes, comments, or visitors.')


if __name__ == '__main__':
    main()
