"""robots.txt and sitemaps: the two files a site publishes about itself."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import urljoin

from .guard import match_path

MAX_CRAWL_DELAY = 10.0


@dataclass
class Robots:
    """The rules that apply to us, plus the sitemaps the file names."""

    disallow: list[str] = field(default_factory=list)
    allow: list[str] = field(default_factory=list)
    sitemaps: list[str] = field(default_factory=list)
    crawl_delay: float | None = None

    def allows(self, url: str) -> bool:
        path = match_path(url)
        best: tuple[int, bool] | None = None
        for rule, verdict in [(r, False) for r in self.disallow] + [(r, True) for r in self.allow]:
            if not rule:
                continue
            if _match(rule, path):
                if best is None or len(rule) > best[0] or (len(rule) == best[0] and verdict):
                    best = (len(rule), verdict)
        return True if best is None else best[1]


def _match(rule: str, path: str) -> bool:
    pattern = re.escape(rule).replace(r"\*", ".*")
    if pattern.endswith(r"\$"):
        pattern = pattern[:-2] + "$"
    return re.match(pattern, path) is not None


def parse_robots(text: str, base: str, agent: str = "alldash") -> Robots:
    """Rules from the most specific matching User-agent group, sitemaps from anywhere."""
    groups: dict[str, Robots] = {}
    current: list[str] = []
    sitemaps: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, value = (s.strip() for s in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            name = value.lower()
            if current and groups.get(current[-1]) and (groups[current[-1]].allow or groups[current[-1]].disallow):
                current = []
            current.append(name)
            groups.setdefault(name, Robots())
        elif key == "sitemap":
            sitemaps.append(urljoin(base, value))
        elif key in ("disallow", "allow", "crawl-delay"):
            for name in current:
                g = groups.setdefault(name, Robots())
                if key == "disallow":
                    g.disallow.append(value)
                elif key == "allow":
                    g.allow.append(value)
                else:
                    try:
                        # A hostile or careless Crawl-delay must not park a worker for hours.
                        g.crawl_delay = min(MAX_CRAWL_DELAY, max(0.0, float(value)))
                    except ValueError:
                        pass
    chosen = groups.get(agent.lower()) or groups.get("*") or Robots()
    chosen.sitemaps = list(dict.fromkeys(sitemaps))
    return chosen


def parse_sitemap(text: str, base: str) -> tuple[list[str], list[str]]:
    """(page urls, nested sitemap urls) from a urlset or a sitemapindex."""
    pages: list[str] = []
    nested: list[str] = []
    try:
        root = ET.fromstring(text.encode() if isinstance(text, str) else text)
    except ET.ParseError:
        # Plain text sitemaps are one URL per line.
        for line in text.splitlines():
            line = line.strip()
            if line.startswith(("http://", "https://")):
                pages.append(line)
        return pages, nested
    tag = root.tag.lower()
    for loc in root.iter():
        if loc.tag.lower().endswith("loc") and loc.text:
            url = urljoin(base, loc.text.strip())
            (nested if tag.endswith("sitemapindex") else pages).append(url)
    return list(dict.fromkeys(pages)), list(dict.fromkeys(nested))
