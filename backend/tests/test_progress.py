import unittest
from unittest.mock import patch
from app.config import settings
from app.schemas import RevealPoint, UserProgress
from app.services.progress import get_progress, save_progress


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(settings, "database_url", "configured"))
        self.db = self.enterContext(patch("app.services.progress.connection"))
        self.conn = self.db.return_value.__enter__.return_value

    def test_save_and_read_scope_every_query_to_verified_owner(self):
        progress = UserProgress(media_id="lantern-harbor", progress=RevealPoint(unit=2))
        self.assertEqual(save_progress("user-a", progress), progress)
        self.assertEqual(self.conn.execute.call_args.args[1], ("user-a", "lantern-harbor", 2))
        self.conn.execute.return_value.fetchone.return_value = (2,)
        self.assertEqual(get_progress("user-a", "lantern-harbor"), progress)
        self.assertEqual(self.conn.execute.call_args.args[1], ("user-a", "lantern-harbor"))
        self.conn.execute.return_value.fetchone.return_value = None
        self.assertIsNone(get_progress("user-b", "lantern-harbor"))
        self.assertEqual(self.conn.execute.call_args.args[1], ("user-b", "lantern-harbor"))

    def test_database_failures_become_503(self):
        import psycopg
        from fastapi import HTTPException
        progress = UserProgress(media_id="lantern-harbor", progress=RevealPoint(unit=1))
        for error in [psycopg.errors.UndefinedTable("no table"), psycopg.OperationalError("unreachable")]:
            self.conn.execute.side_effect = error
            for call in [lambda: get_progress("u", "lantern-harbor"), lambda: save_progress("u", progress)]:
                with self.subTest(error=type(error).__name__), self.assertRaises(HTTPException) as raised:
                    call()
                self.assertEqual(raised.exception.status_code, 503)
        with patch.object(settings, "database_url", ""), self.assertRaises(HTTPException) as raised:
            get_progress("u", "lantern-harbor")
        self.assertEqual(raised.exception.status_code, 503)
