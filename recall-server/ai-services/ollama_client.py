import logging
import os

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
except ImportError:
    pass

logger = logging.getLogger(__name__)

OLLAMA_EMBEDDING_MODEL = "bge-m3"


def _get_ollama_url():
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def get_fallback_model(attempted_model):
    ollama_url = _get_ollama_url()
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=15)
        if response.status_code == 200:
            models = response.json().get("models", [])
            names = [model.get("name") for model in models if model.get("name")]
            if not names:
                return None

            base = attempted_model.split(":")[0]
            for name in names:
                if name.startswith(base):
                    return name
            return names[0]
    except Exception as exc:
        logger.error("Failed to fetch Ollama model list from %s: %s", ollama_url, exc)
    return None


def generate_embeddings(texts, model=OLLAMA_EMBEDDING_MODEL):
    """
    Computes vector embeddings for a list of texts using local Ollama bge-m3.
    Keeps the original behavior: batch /api/embed first, then single
    /api/embeddings fallback, then zero vectors as an error fallback.
    """
    ollama_url = _get_ollama_url()
    selected_model = get_fallback_model(model) or model
    logger.info("Using Ollama embedding model: %s", selected_model)

    payload = {
        "model": selected_model,
        "input": texts,
    }

    try:
        response = requests.post(f"{ollama_url}/api/embed", json=payload, timeout=60)
        if response.status_code == 200:
            return response.json().get("embeddings", [])

        logger.info("Ollama batch embed returned %s, falling back to single /api/embeddings", response.status_code)
        embeddings = []
        for text in texts:
            single_payload = {"model": selected_model, "prompt": text}
            single_response = requests.post(f"{ollama_url}/api/embeddings", json=single_payload, timeout=30)
            if single_response.status_code == 200:
                embeddings.append(single_response.json().get("embedding", []))
            else:
                logger.error("Ollama single embedding failed (%s): %s", single_response.status_code, single_response.text)
                embeddings.append([0.0] * 1024)
        return embeddings
    except Exception as exc:
        logger.error("Failed to communicate with Ollama for embeddings: %s", exc)
        return [[0.0] * 1024 for _ in texts]
