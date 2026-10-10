from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env", extra="ignore"
    )
    database_url: str = ""
    hf_token: str = ""
    anilist_api_url: str = "https://graphql.anilist.co"
    frontend_url: str = "http://localhost:3000"
    neon_auth_jwks_url: str = ""
    neon_auth_issuer: str = ""
    neon_auth_audience: str = ""


settings = Settings()
