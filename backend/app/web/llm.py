"""A model on the backend, for Extract and Agent only.

Same three provider shapes as the browser assistant (Anthropic Messages,
OpenAI-compatible chat completions, Ollama), spoken over httpx. Off until
ALLDASH_LLM_PROVIDER and, where needed, ALLDASH_LLM_API_KEY are set. The
brain, triage and the daily engine never come near this module.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_MODELS = {"anthropic": "claude-sonnet-5", "openai": "gpt-4o-mini", "ollama": "llama3.1"}
DEFAULT_BASE = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434",
}


class LlmError(Exception):
    pass


class LlmNotConfigured(LlmError):
    pass


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    model: str
    api_key: str
    base_url: str
    max_tokens: int = 4096

    @property
    def configured(self) -> bool:
        if self.provider not in DEFAULT_MODELS:
            return False
        return self.provider == "ollama" or bool(self.api_key)


class Llm:
    def __init__(
        self, config: LlmConfig, *, timeout: float = 120.0, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.config = config
        self._client = httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(timeout))

    async def aclose(self) -> None:
        await self._client.aclose()

    async def complete(self, system: str, user: str) -> str:
        c = self.config
        if not c.configured:
            raise LlmNotConfigured(
                "No model is configured on the backend: "
                "set ALLDASH_LLM_PROVIDER, ALLDASH_LLM_MODEL and ALLDASH_LLM_API_KEY"
            )
        try:
            if c.provider == "anthropic":
                response = await self._client.post(
                    f"{c.base_url}/v1/messages",
                    headers={
                        "x-api-key": c.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": c.model,
                        "max_tokens": c.max_tokens,
                        "system": system,
                        "messages": [{"role": "user", "content": user}],
                    },
                )
                data = self._ok(response)
                return "".join(
                    block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"
                )
            if c.provider == "ollama":
                response = await self._client.post(
                    f"{c.base_url}/api/chat",
                    json={
                        "model": c.model,
                        "stream": False,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                        "options": {"num_predict": c.max_tokens},
                    },
                )
                return str(self._ok(response).get("message", {}).get("content", ""))
            response = await self._client.post(
                f"{c.base_url}/chat/completions",
                headers={"authorization": f"Bearer {c.api_key}", "content-type": "application/json"},
                json={
                    "model": c.model,
                    "max_tokens": c.max_tokens,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                },
            )
            data = self._ok(response)
            return str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
        except httpx.HTTPError as exc:
            raise LlmError(f"{c.provider} unreachable: {exc.__class__.__name__}") from exc

    @staticmethod
    def _ok(response: httpx.Response) -> dict[str, Any]:
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code >= 400:
            detail = (
                data.get("error", {}).get("message")
                if isinstance(data.get("error"), dict)
                else data.get("error") or response.text[:200]
            )
            raise LlmError(f"model provider returned {response.status_code}: {detail}")
        return data


def parse_json_reply(text: str) -> Any:
    """The JSON object or array a model was asked for, fenced or bare."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    candidate = candidate.strip()
    try:
        return json.loads(candidate)
    except ValueError:
        pass
    start = min([i for i in (candidate.find("{"), candidate.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise LlmError("The model did not return JSON")
    end = max(candidate.rfind("}"), candidate.rfind("]"))
    try:
        return json.loads(candidate[start : end + 1])
    except ValueError as exc:
        raise LlmError("The model returned malformed JSON") from exc


EXTRACT_SYSTEM = (
    "You extract structured data from web page content. Answer with JSON only, no prose, no Markdown fence. "
    "When a schema is given, the JSON must match it exactly: same keys, same types, "
    "null for anything the page does not say. "
    "Never invent values. Quote numbers as numbers and dates as ISO 8601 strings."
)


async def extract(
    llm: Llm, *, pages: list[dict[str, str]], prompt: str, schema: dict[str, Any] | None, budget_chars: int = 60_000
) -> Any:
    """Ask the model for JSON over one or more pages, trimmed to a character budget."""
    per_page = max(2000, budget_chars // max(1, len(pages)))
    body = []
    for page in pages:
        content = (page.get("markdown") or page.get("text") or "")[:per_page]
        body.append(f"<page url=\"{page.get('url', '')}\" title=\"{page.get('title', '')}\">\n{content}\n</page>")
    parts = [prompt.strip()]
    if schema:
        parts.append("Schema (JSON Schema):\n" + json.dumps(schema, separators=(",", ":")))
    parts.append("\n".join(body))
    reply = await llm.complete(EXTRACT_SYSTEM, "\n\n".join(parts))
    return parse_json_reply(reply)
