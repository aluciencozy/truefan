from pathlib import Path
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env", extra="ignore"
    )
    database_url: str = ""
    hf_token: str = ""
    hf_response_format: Literal['schema', 'json', 'prompt'] = 'schema'
    hf_model: str = "Qwen/Qwen3-4B-Instruct-2507:nscale"
    generation_episode_cap: int = Field(default=6, ge=1, le=24)
    generation_jobs_per_user: int = Field(default=3, ge=1, le=20)
    generation_global_daily_limit: int = Field(default=20, ge=1, le=200)
    generation_max_concurrent: int = Field(default=2, ge=1, le=4)
    generation_lease_seconds: int = Field(default=180, ge=120, le=600)
    generation_admin_subject: str = ""
    universe_node_cap: int = Field(default=25, ge=1, le=50)
    universe_depth: int = Field(default=1, ge=0, le=2)
    franchise_cache_ttl_seconds: int = Field(default=86400, gt=0)
    anilist_api_url: str = "https://graphql.anilist.co"
    frontend_url: str = "http://localhost:3000"
    # Blend labelled sample completions into the Explore trending sky so a small demo is never empty.
    trending_demo_signal: bool = True
    neon_auth_jwks_url: str = ""
    neon_auth_base_url: str = ""


settings = Settings()
