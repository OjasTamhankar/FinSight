"""Minimal OpenRouter chat client for grounded answer generation and verification."""
from __future__ import annotations

import os
from typing import Any

import requests


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "baidu/ernie-5.5-flash-preview:free"


class OpenRouterError(RuntimeError):
    """Raised when OpenRouter is unavailable or returns an invalid response."""


class OpenRouterClient:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = (api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "")).strip()
        self.model = (model or os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)).strip()
        self.timeout = float(os.getenv("OPENROUTER_TIMEOUT_SECONDS", "45"))

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def chat(self, messages: list[dict[str, str]], *, reasoning: bool = False) -> str:
        if not self.is_configured:
            raise OpenRouterError("OPENROUTER_API_KEY is not configured on the backend.")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost:5173"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "FinSight Financial RAG"),
        }
        payload: dict[str, Any] = {"model": self.model, "messages": messages}
        if reasoning:
            payload["reasoning"] = {"enabled": True}
        try:
            response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=self.timeout)
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"].get("content")
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
            raise OpenRouterError(f"OpenRouter request failed: {type(exc).__name__}.") from exc
        if not isinstance(content, str) or not content.strip():
            raise OpenRouterError("OpenRouter returned an empty answer.")
        return content.strip()
