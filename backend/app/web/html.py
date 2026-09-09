"""HTML in, a page out: title, description, links, plain text and Markdown.

Built on the standard library's HTMLParser so the platform image carries no
extra dependency. The Markdown is the readable kind: headings, paragraphs,
lists, links, emphasis, code, block quotes and simple tables. Navigation,
scripts, styles and boilerplate elements are dropped before conversion.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

SKIP = frozenset({"script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed"})
BOILERPLATE = frozenset({"nav", "footer", "aside", "form"})
BLOCK = frozenset(
    {
        "p",
        "div",
        "section",
        "article",
        "main",
        "header",
        "li",
        "ul",
        "ol",
        "table",
        "tr",
        "blockquote",
        "pre",
        "hr",
        "br",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "dl",
        "dt",
        "dd",
        "figure",
        "figcaption",
        "details",
        "summary",
    }
)
HEADINGS = {"h1": "#", "h2": "##", "h3": "###", "h4": "####", "h5": "#####", "h6": "######"}
VOID = frozenset({"br", "hr", "img", "meta", "link", "input", "area", "base", "col", "source", "track", "wbr"})


@dataclass
class Page:
    url: str
    title: str = ""
    description: str = ""
    canonical: str = ""
    language: str = ""
    markdown: str = ""
    text: str = ""
    links: list[str] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)


class _Reader(HTMLParser):
    def __init__(self, base: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base = base
        self.out: list[str] = []
        self.links: list[str] = []
        self.title_parts: list[str] = []
        self.meta: dict[str, str] = {}
        self.language = ""
        self.canonical = ""
        self._skip = 0
        self._boiler = 0
        self._pre = 0
        self._in_title = False
        self._list: list[tuple[str, int]] = []
        self._href: str | None = None
        self._link_text: list[str] = []
        self._cell: list[str] | None = None
        self._row: list[str] = []
        self._table: list[list[str]] = []
        self._in_table = 0

    # ----------------------------------------------------------- helpers

    def _write(self, text: str) -> None:
        if self._cell is not None:
            self._cell.append(text)
        elif self._href is not None:
            self._link_text.append(text)
        else:
            self.out.append(text)

    def _newline(self, n: int = 1) -> None:
        if self._cell is not None or self._href is not None:
            return
        self.out.append("\n" * n)

    # ---------------------------------------------------------- handlers

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "html" and a.get("lang"):
            self.language = a["lang"]
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content"):
                self.meta[key] = a["content"].strip()
            return
        if tag == "link" and a.get("rel", "").lower() == "canonical" and a.get("href"):
            self.canonical = urljoin(self.base, a["href"])
            return
        if tag in SKIP:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = True
            return
        if tag in BOILERPLATE:
            self._boiler += 1
            return
        if self._boiler:
            if tag == "a" and a.get("href"):
                self._add_link(a["href"])
            return
        if tag in HEADINGS:
            self._newline(2)
            self._write(f"{HEADINGS[tag]} ")
        elif tag == "p":
            self._newline(2)
        elif tag in ("ul", "ol"):
            self._newline(2 if not self._list else 1)
            self._list.append((tag, 0))
        elif tag == "li":
            if self._list:
                kind, n = self._list[-1]
                self._list[-1] = (kind, n + 1)
                indent = "  " * (len(self._list) - 1)
                marker = f"{n + 1}." if kind == "ol" else "-"
                self._newline(1)
                self._write(f"{indent}{marker} ")
            else:
                self._newline(1)
                self._write("- ")
        elif tag == "a":
            href = a.get("href", "")
            if href:
                self._add_link(href)
                if self._cell is None:
                    self._href = urljoin(self.base, href)
                    self._link_text = []
        elif tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("_")
        elif tag == "code" and not self._pre:
            self._write("`")
        elif tag == "pre":
            self._pre += 1
            self._newline(2)
            self._write("```\n")
        elif tag == "blockquote":
            self._newline(2)
            self._write("> ")
        elif tag == "hr":
            self._newline(2)
            self._write("---")
            self._newline(2)
        elif tag == "br":
            self._write("\n")
        elif tag == "img":
            alt = a.get("alt", "").strip()
            src = a.get("src", "")
            if src:
                self._write(f"![{alt}]({urljoin(self.base, src)})")
        elif tag == "table":
            self._in_table += 1
            self._table = []
        elif tag == "tr" and self._in_table:
            self._row = []
        elif tag in ("td", "th") and self._in_table:
            self._cell = []
        elif tag in BLOCK:
            self._newline(1)

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = False
            return
        if tag in BOILERPLATE:
            self._boiler = max(0, self._boiler - 1)
            return
        if self._boiler:
            return
        if tag in HEADINGS or tag == "p":
            self._newline(2)
        elif tag in ("ul", "ol"):
            if self._list:
                self._list.pop()
            self._newline(2 if not self._list else 1)
        elif tag == "a" and self._href is not None:
            text = " ".join("".join(self._link_text).split())
            href = self._href
            self._href = None
            if text:
                if self.out and not self.out[-1].endswith(("\n", " ", "(", "[")):
                    self._write(" ")
                self._write(f"[{text}]({href})")
        elif tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("_")
        elif tag == "code" and not self._pre:
            self._write("`")
        elif tag == "pre":
            self._pre = max(0, self._pre - 1)
            self._write("\n```")
            self._newline(2)
        elif tag == "blockquote":
            self._newline(2)
        elif tag in ("td", "th") and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._in_table:
            if self._row:
                self._table.append(self._row)
            self._row = []
        elif tag == "table" and self._in_table:
            self._in_table -= 1
            self._emit_table()
        elif tag == "li":
            pass  # the next item or the list's end supplies the newline
        elif tag in BLOCK:
            self._newline(1)

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._in_title:
            self.title_parts.append(data)
            return
        if self._boiler:
            return
        if self._pre:
            self._write(data)
            return
        text = re.sub(r"\s+", " ", data)
        if text.strip() or (self.out and not self.out[-1].endswith(("\n", " "))):
            self._write(text)

    def _add_link(self, href: str) -> None:
        if href.startswith(("javascript:", "mailto:", "tel:", "data:")):
            return
        absolute = urljoin(self.base, href.split("#", 1)[0]).strip()
        if absolute and urlsplit(absolute).scheme in ("http", "https"):
            self.links.append(absolute)

    def _emit_table(self) -> None:
        rows = [r for r in self._table if any(c for c in r)]
        self._table = []
        if not rows:
            return
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        self._newline(2)
        self.out.append("| " + " | ".join(rows[0]) + " |\n")
        self.out.append("| " + " | ".join("---" for _ in range(width)) + " |\n")
        for r in rows[1:]:
            self.out.append("| " + " | ".join(r) + " |\n")
        self._newline(1)


def _tidy(markdown: str) -> str:
    lines = [line.rstrip() for line in markdown.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n" if text.strip() else ""


def parse_html(html: str, url: str) -> Page:
    reader = _Reader(url)
    reader.feed(html)
    reader.close()
    markdown = _tidy("".join(reader.out))
    title = " ".join("".join(reader.title_parts).split()) or reader.meta.get("og:title", "")
    seen: set[str] = set()
    links = [link for link in reader.links if not (link in seen or seen.add(link))]
    text = re.sub(r"[#*_`>|\-]{1,}", " ", markdown)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    return Page(
        url=url,
        title=title[:300],
        description=(reader.meta.get("description") or reader.meta.get("og:description") or "")[:1000],
        canonical=reader.canonical,
        language=reader.language,
        markdown=markdown,
        text=text,
        links=links,
        metadata={
            k: v[:500]
            for k, v in reader.meta.items()
            if k.startswith(("og:", "article:", "twitter:")) or k in ("author", "keywords", "generator")
        },
    )
