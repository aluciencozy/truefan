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


@lru_cache
def jwks_client() -> PyJWKClient:
    # The URL comes from trusted server configuration, never the request/JWT.
    return PyJWKClient(settings.neon_auth_jwks_url, timeout=5)


def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> CurrentUser:
    if credentials is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    if (not settings.neon_auth_issuer
            or urlparse(settings.neon_auth_jwks_url).scheme != "https"):
        raise HTTPException(503, "Configure the Neon Auth issuer and HTTPS JWKS URL")
    try:
        key = jwks_client().get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials, key.key,
            algorithms=["EdDSA", "RS256", "ES256"],
            issuer=settings.neon_auth_issuer,
            audience=settings.neon_auth_audience or None,
            options={"require": ["exp", "iss", "sub"],
                     "verify_aud": bool(settings.neon_auth_audience)},
        )
        subject = claims["sub"]
        if not isinstance(subject, str) or not subject:
            raise jwt.InvalidTokenError("Missing user subject")
        return CurrentUser(id=subject)
    except jwt.PyJWKClientConnectionError as error:
        raise HTTPException(503, "Identity provider temporarily unavailable") from error
    except jwt.PyJWTError as error:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}) from error
