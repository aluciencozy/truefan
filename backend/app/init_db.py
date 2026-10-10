from pathlib import Path
from app.database import connection


def main():
    with connection() as conn:
        conn.execute(Path(__file__).with_name("schema.sql").read_text())
    print("Application progress and generated-graph tables are ready.")


if __name__ == "__main__":
    main()
