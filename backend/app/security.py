"""API-key authentication.

One header, `X-API-Key`, checked in constant time against the configured set.
The frontend keeps its key server-side and proxies browser calls, so a key
never reaches a browser. Health endpoints are open so probes need no secret.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from .config import Settings, get_settings

_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _matches(presented: str, accepted: frozenset[str]) -> bool:
    # Compare against every key so timing does not reveal which one is close.
    found = False
    for key in accepted:
        if hmac.compare_digest(presented.encode(), key.encode()):
            found = True
    return found


async def require_api_key(
    presented: Annotated[str | None, Security(_header)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> str:
    if not settings.auth_required:
        return "local"
    if not presented or not _matches(presented, settings.api_key_set):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid API key")
    return presented


Authed = Annotated[str, Depends(require_api_key)]
