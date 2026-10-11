"""Initialize the additive community tables without creating sample posts."""
from pathlib import Path
from app.database import connection


def main() -> None:
    with connection() as conn:
        conn.execute(Path(__file__).with_name('community_schema.sql').read_text())
    print('Community tables ready. No starter posts are created.')


if __name__ == '__main__':
    main()
