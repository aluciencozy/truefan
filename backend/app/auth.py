import json
from functools import lru_cache
from typing import Annotated
from urllib.parse import urlparse
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.config import settings
from app.schemas import CurrentUser

bearer = HTTPBearer(auto_error=False)


def verification_config() -> tuple[str, str]:
    """Neon Managed Better Auth: iss/aud are the origin, JWKS uses the full base path.

    https://neon.com/docs/auth/guides/plugins/jwt (Python verification example).
    Values come only from trusted configuration, never a JWT's claims/headers.
    """
    base = settings.neon_auth_base_url.rstrip("/")
    parsed = urlparse(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment):
        raise HTTPException(503, "Configure NEON_AUTH_BASE_URL from the Neon branch Auth URL")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    jwks_url = settings.neon_auth_jwks_url or f"{base}/.well-known/jwks.json"
    jwks = urlparse(jwks_url)
    if (jwks.scheme != "https" or not jwks.hostname or jwks.username or jwks.password
            or jwks.fragment):
        raise HTTPException(503, "Configure a trusted HTTPS Neon Auth JWKS URL")
    return origin, jwks_url


@lru_cache
def jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(url, timeout=5)


def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> CurrentUser:
    if credentials is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    origin, jwks_url = verification_config()
    try:
        key = jwks_client(jwks_url).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials, key.key, algorithms=["EdDSA"],
            issuer=origin, audience=origin,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
        subject = claims["sub"]
        if not isinstance(subject, str) or not subject:
            raise jwt.InvalidTokenError("Missing user subject")
        return CurrentUser(id=subject)
    except (jwt.PyJWKClientConnectionError, json.JSONDecodeError) as error:
        # JSONDecodeError: the JWKS endpoint answered with a non-JSON body (e.g. a proxy error page).
        raise HTTPException(503, "Identity provider temporarily unavailable") from error
    except jwt.PyJWTError as error:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}) from error
