"""Connect to the address the guard vetted, not to whatever DNS says next.

check_url() resolves a host and approves its addresses; without this, httpx
would resolve the name again and a rebinding DNS server could hand it a
private address the guard never saw. The transport keeps a table of host to
approved address and dials that address, while TLS still verifies the
certificate against the host name.
"""

from __future__ import annotations

import ssl
from typing import Any

import httpcore
import httpx
from httpcore._backends.auto import AutoBackend


class PinnedBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, pins: dict[str, str]) -> None:
        self._inner = AutoBackend()
        self.pins = pins

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore's interface names the parameter
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.AsyncNetworkStream:
        target = self.pins.get(host.lower(), host)
        return await self._inner.connect_tcp(
            target, port, timeout=timeout, local_address=local_address, socket_options=socket_options
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109
        socket_options: Any = None,
    ) -> httpcore.AsyncNetworkStream:
        return await self._inner.connect_unix_socket(path, timeout=timeout, socket_options=socket_options)

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class PinnedTransport(httpx.AsyncHTTPTransport):
    """httpx's default transport with the pinned network backend underneath."""

    def __init__(self, pins: dict[str, str], *, verify: bool | ssl.SSLContext = True, **kwargs: Any) -> None:
        super().__init__(verify=verify, **kwargs)
        ctx = httpx.create_ssl_context(verify=verify) if not isinstance(verify, ssl.SSLContext) else verify
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ctx,
            max_connections=20,
            max_keepalive_connections=10,
            keepalive_expiry=5.0,
            http1=True,
            http2=False,
            network_backend=PinnedBackend(pins),
        )
