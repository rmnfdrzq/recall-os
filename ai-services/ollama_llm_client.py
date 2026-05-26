import logging
import os
import re

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
except ImportError:
    pass

logger = logging.getLogger(__name__)

OLLAMA_LLM_MODEL = "gemma4:31b-cloud"


def _get_ollama_url():
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def _select_model(model=None):
    return model or os.environ.get("OLLAMA_LLM_MODEL", OLLAMA_LLM_MODEL)


def _image_data_url_to_base64(data_url):
    match = re.match(r"^data:[^;]+;base64,(.+)$", data_url or "", flags=re.DOTALL)
    if not match:
        return None
    return match.group(1).strip()


def _normalize_message(message):
    content = message.get("content", "")
    if not isinstance(content, list):
        return {
            "role": message.get("role", "user"),
            "content": str(content),
        }

    text_parts = []
    images = []
    for part in content:
        if part.get("type") == "text":
            text_parts.append(part.get("text", ""))
            continue

        if part.get("type") == "image_url":
            image_url = part.get("image_url", {}).get("url", "")
            encoded = _image_data_url_to_base64(image_url)
            if encoded:
                images.append(encoded)

    normalized = {
        "role": message.get("role", "user"),
        "content": "\n".join(text for text in text_parts if text).strip(),
    }
    if images:
        normalized["images"] = images
    return normalized


def generate_ollama_llm_completion(messages, *, model=None, temperature=0.3, max_tokens=2048):
    """
    Universal LLM fallback through local Ollama.
    Uses gemma4:31b-cloud by default for both text and vision-shaped requests.
    """
    selected_model = _select_model(model)
    payload = {
        "model": selected_model,
        "messages": [_normalize_message(message) for message in messages],
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    ollama_url = _get_ollama_url()
    response = requests.post(f"{ollama_url}/api/chat", json=payload, timeout=180)
    if response.status_code >= 400:
        raise RuntimeError(f"Ollama LLM error ({response.status_code}) for {selected_model}: {response.text}")

    data = response.json()
    return data.get("message", {}).get("content", "") or ""
