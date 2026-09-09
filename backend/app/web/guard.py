"""Which URLs the server will fetch on a caller's behalf.

A scraper that reaches http://169.254.169.254/ or a database on the pod
network is a hole, whatever the API key says. Every URL, and every redirect
hop, is resolved here first: only http and https, only public addresses, and
never the cluster's own names.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

ALLOWED_SCHEMES = frozenset({"http", "https"})
BLOCKED_HOST_SUFFIXES = (".local", ".internal", ".localhost", ".svc", ".cluster.local")
BLOCKED_HOSTS = frozenset({"localhost", "metadata", "metadata.google.internal", "instance-data"})


class BlockedUrl(ValueError):
    """The URL is not one this server will fetch."""


@dataclass(frozen=True)
class CheckedUrl:
    url: str
    host: str
    scheme: str
    addresses: tuple[str, ...]


def normalise(url: str) -> str:
    """Trim, drop the fragment, default the scheme, lower-case the host."""
    raw = url.strip()
    if not raw:
        raise BlockedUrl("Empty URL")
    if "://" not in raw:
        raw = f"https://{raw}"
    parts = urlsplit(raw)
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise BlockedUrl(f"Only http and https are fetched, not {parts.scheme or 'this'}")
    if not parts.hostname:
        raise BlockedUrl("The URL has no host")
    if parts.username or parts.password:
        raise BlockedUrl("Credentials in URLs are not forwarded")
    host = parts.hostname.lower().rstrip(".")
    netloc = host if parts.port is None else f"{host}:{parts.port}"
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", parts.query, ""))


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv6Address) and ip.is_site_local)
    )


def _host_blocked(host: str) -> bool:
    return host in BLOCKED_HOSTS or any(host.endswith(suffix) for suffix in BLOCKED_HOST_SUFFIXES) or "." not in host


async def _resolve(host: str) -> tuple[str, ...]:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
        raise BlockedUrl(f"Could not resolve {host}") from exc
    return tuple(sorted({info[4][0] for info in infos}))


async def check_url(url: str, *, allow_private: bool = False) -> CheckedUrl:
    """Normalise and vet one URL; raises BlockedUrl with a plain reason."""
    clean = normalise(url)
    parts = urlsplit(clean)
    host = parts.hostname or ""
    if allow_private:
        return CheckedUrl(url=clean, host=host, scheme=parts.scheme, addresses=())
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(literal):
            raise BlockedUrl(f"{host} is not a public address")
        return CheckedUrl(url=clean, host=host, scheme=parts.scheme, addresses=(str(literal),))
    if _host_blocked(host):
        raise BlockedUrl(f"{host} is not a public host name")
    addresses = await _resolve(host)
    for address in addresses:
        if not _is_public(ipaddress.ip_address(address)):
            raise BlockedUrl(f"{host} resolves to a non-public address")
    return CheckedUrl(url=clean, host=host, scheme=parts.scheme, addresses=addresses)


def same_site(a: str, b: str) -> bool:
    """Same registrable host, ignoring a leading www."""
    strip = lambda h: (h or "").lower().removeprefix("www.")  # noqa: E731
    return strip(urlsplit(a).hostname) == strip(urlsplit(b).hostname)
