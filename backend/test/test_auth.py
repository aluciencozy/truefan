import time
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import jwt
from app.auth import current_user, verification_config
from app.config import settings


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.origin = "https://branch.example.test"
        self.base = self.origin + "/neondb/auth"
        self.private_key = Ed25519PrivateKey.generate()
        public_jwk = jwt.algorithms.OKPAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        public_jwk["kid"] = "test-key"
        self.client = jwt.PyJWKClient(self.base + "/.well-known/jwks.json")
        self.enterContext(patch.object(self.client, "fetch_data", return_value={"keys": [public_jwk]}))
        self.enterContext(patch("app.auth.jwks_client", return_value=self.client))
        self.enterContext(patch.object(settings, "neon_auth_base_url", self.base))
        self.enterContext(patch.object(settings, "neon_auth_jwks_url", ""))

    def token(self, **changes):
        claims = {"sub": "user-a", "iss": self.origin, "aud": self.origin,
                  "iat": int(time.time()), "exp": int(time.time()) + 900}
        claims.update(changes)
        return jwt.encode(claims, self.private_key, algorithm="EdDSA", headers={"kid": "test-key"})

    def verify(self, token):
        return current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

    def test_documented_origin_and_full_jwks_path(self):
        self.assertEqual(verification_config(), (self.origin, self.base + "/.well-known/jwks.json"))
        self.assertEqual(self.verify(self.token()).id, "user-a")

    def test_invalid_claims_and_expiry(self):
        for change in [{"iss": self.base}, {"aud": "another-api"}, {"aud": None},
                       {"exp": 1}, {"sub": ""}, {"sub": 123}, {"iat": int(time.time()) + 3600}]:
            with self.subTest(change=change), self.assertRaises(HTTPException) as raised:
                self.verify(self.token(**change))
            self.assertEqual(raised.exception.status_code, 401)

    def test_missing_required_claims(self):
        for claim in ["sub", "iss", "aud", "exp", "iat"]:
            claims = jwt.decode(self.token(), options={"verify_signature": False})
            del claims[claim]
            token = jwt.encode(claims, self.private_key, algorithm="EdDSA", headers={"kid": "test-key"})
            with self.subTest(claim=claim), self.assertRaises(HTTPException) as raised:
                self.verify(token)
            self.assertEqual(raised.exception.status_code, 401)

    def test_wrong_signature_session_identifier_and_symmetric_algorithm(self):
        claims = jwt.decode(self.token(), options={"verify_signature": False})
        wrong_signature = jwt.encode(claims, Ed25519PrivateKey.generate(), algorithm="EdDSA", headers={"kid": "test-key"})
        symmetric = jwt.encode(claims, "test-only-secret-at-least-32-bytes", algorithm="HS256", headers={"kid": "test-key"})
        for token in [wrong_signature, symmetric, "opaque-session-cookie"]:
            with self.subTest(kind=token.split('.')[0]), self.assertRaises(HTTPException) as raised:
                self.verify(token)
            self.assertEqual(raised.exception.status_code, 401)

    def test_missing_auth_and_configuration(self):
        with self.assertRaises(HTTPException) as raised:
            current_user(None)
        self.assertEqual(raised.exception.status_code, 401)
        with patch.object(settings, "neon_auth_base_url", ""), self.assertRaises(HTTPException) as raised:
            self.verify(self.token())
        self.assertEqual(raised.exception.status_code, 503)

    def test_provider_unavailable(self):
        with patch.object(self.client, "get_signing_key_from_jwt", side_effect=jwt.PyJWKClientConnectionError("offline")):
            with self.assertRaises(HTTPException) as raised:
                self.verify(self.token())
            self.assertEqual(raised.exception.status_code, 503)
