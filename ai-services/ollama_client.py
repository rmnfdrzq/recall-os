import os
import re
import json
import logging
import requests

try:
    from dotenv import load_dotenv
    # Load .env from parent directory of ai-services
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
except ImportError:
    pass

logger = logging.getLogger(__name__)

# Read dynamically at call time so .env changes don't require module reload
def _get_ollama_url():
    return os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11435').rstrip('/')

def _get_llm_model():
    return os.environ.get('OLLAMA_LLM_MODEL', 'qwen2.5:1.5b')

def _get_embed_model():
    return os.environ.get('OLLAMA_EMBED_MODEL', 'nomic-embed-text')

# Keep module-level names for backward compatibility (imported by views.py)
OLLAMA_BASE_URL = _get_ollama_url()
OLLAMA_LLM_MODEL = _get_llm_model()
OLLAMA_EMBED_MODEL = _get_embed_model()


def generate_embedding(text):
    """
    Generates a dense vector embedding using Ollama.
    Supports both /api/embed (newer) and /api/embeddings (older) endpoint signatures.
    """
    ollama_url = _get_ollama_url()
    embed_model = _get_embed_model()

    # Newer endpoint signature (/api/embed)
    try:
        url = f"{ollama_url}/api/embed"
        payload = {
            "model": embed_model,
            "input": text if isinstance(text, list) else [text]
        }
        response = requests.post(url, json=payload, timeout=30)
        if response.status_code == 200:
            data = response.json()
            embeddings = data.get('embeddings', [])
            if embeddings:
                return embeddings[0] if not isinstance(text, list) else embeddings
    except Exception as e:
        logger.warning(f"Newer Ollama /api/embed API failed, trying older legacy /api/embeddings. Error: {e}")

    # Legacy endpoint signature fallback (/api/embeddings)
    try:
        url = f"{ollama_url}/api/embeddings"
        payload = {
            "model": embed_model,
            "prompt": text
        }
        response = requests.post(url, json=payload, timeout=30)
        if response.status_code == 200:
            return response.json().get('embedding', [])
    except Exception as e:
        logger.error(f"Legacy Ollama /api/embeddings also failed. Vector search will be unavailable. Error: {e}")

    # Return empty list in case of absolute failure so it doesn't crash the pipeline entirely
    return []


def get_fallback_model(attempted_model):
    ollama_url = _get_ollama_url()
    try:
        url = f"{ollama_url}/api/tags"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            models = response.json().get('models', [])
            names = [m.get('name') for m in models]
            if not names:
                return None

            # Prefer model with matching base name, then qwen, then first available
            base = attempted_model.split(':')[0]
            for name in names:
                if name.startswith(base):
                    return name
            for name in names:
                if name.startswith('qwen'):
                    return name
            return names[0]
    except Exception as e:
        logger.error(f"Failed to get fallback model from Docker Ollama ({ollama_url}): {e}")
    return None


def generate_completion(prompt, system_prompt=None, stream=False, model=None):
    """
    Generates a response from the local Docker Ollama LLM.
    """
    ollama_url = _get_ollama_url()
    selected_model = model or _get_llm_model()
    url = f"{ollama_url}/api/generate"
    payload = {
        "model": selected_model,
        "prompt": prompt,
        "stream": stream,
        "options": {
            "temperature": 0.3,
            "top_p": 0.9,
        }
    }
    if system_prompt:
        payload["system"] = system_prompt

    try:
        if stream:
            # Returns a generator yielding text blocks
            def stream_generator():
                response = requests.post(url, json=payload, stream=True, timeout=60)
                if response.status_code != 200:
                    fallback = get_fallback_model(selected_model)
                    if fallback and fallback != selected_model:
                        logger.info(f"Ollama model {selected_model} not found for stream, falling back to {fallback}")
                        payload["model"] = fallback
                        response = requests.post(url, json=payload, stream=True, timeout=60)

                if response.status_code == 200:
                    for line in response.iter_lines():
                        if line:
                            chunk = json.loads(line.decode('utf-8'))
                            yield chunk.get('response', '')
                else:
                    yield f"Error calling Ollama model: Status {response.status_code}"
            return stream_generator()
        else:
            response = requests.post(url, json=payload, timeout=60)
            if response.status_code == 404 or (response.status_code != 200 and "not found" in response.text):
                fallback = get_fallback_model(selected_model)
                if fallback and fallback != selected_model:
                    logger.info(f"Ollama model {selected_model} not found, falling back to {fallback}")
                    payload["model"] = fallback
                    response = requests.post(url, json=payload, timeout=60)

            if response.status_code == 200:
                return response.json().get('response', '')
            else:
                return f"Error calling Ollama: {response.text}"
    except Exception as e:
        logger.error(f"Failed to communicate with Docker Ollama model {selected_model}: {e}")
        return f"Error connecting to Ollama backend: {str(e)}"


def clean_fallback_title(filename):
    if not filename:
        return "Untitled Document"
    # Strip extension
    name, ext = os.path.splitext(filename)
    # Replace underscores/dashes with spaces for better aesthetics
    cleaned = name.replace('_', ' ').replace('-', ' ').strip()
    return cleaned if cleaned else name


def extract_metadata(document_text, fallback_title=None):
    """
    Uses the local LLM to extract structured metadata (JSON) from raw document text.
    """
    default_title = clean_fallback_title(fallback_title)
    system_prompt = (
        "You are an AI knowledge cataloging assistant. You analyze raw text and extract structured metadata.\n"
        "You MUST return ONLY a raw valid JSON object. No markdown wrapping, no explanation, no backticks.\n"
        "Structure template:\n"
        "{\n"
        "  \"suggested_title\": \"Short clear title of the text\",\n"
        "  \"summary\": \"Concise 3-line summary explaining the core message\",\n"
        "  \"category\": \"Single-word general category (e.g. Technology, Finance, Cooking, Health, Engineering)\",\n"
        "  \"tags\": [\"tag1\", \"tag2\", \"tag3\"]\n"
        "}"
    )

    # Supply first 3000 characters to prevent overloading context window
    text_sample = document_text[:3000]
    prompt = f"Analyze the following text sample and extract metadata in the exact JSON format specified:\n\n{text_sample}"

    raw_response = generate_completion(prompt, system_prompt=system_prompt, stream=False)

    # Attempt to parse strict JSON
    try:
        # Simple cleanup in case LLM outputs markdown code blocks
        clean_text = raw_response.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        metadata = json.loads(clean_text)
        suggested_title = metadata.get("suggested_title", "").strip()
        if not suggested_title or suggested_title.lower() in ["untitled", "untitled document", "untitled_document"]:
            suggested_title = default_title

        # Ensure all keys are populated
        return {
            "suggested_title": suggested_title,
            "summary": metadata.get("summary", "No summary generated."),
            "category": metadata.get("category", "General"),
            "tags": metadata.get("tags", [])
        }
    except Exception as e:
        logger.warning(f"Ollama structured JSON metadata extraction failed, falling back to regex. Raw: {raw_response}. Error: {e}")

        # Super robust regex fallbacks if LLM fails to output valid JSON
        title_match = re.search(r'"suggested_title":\s*"([^"]+)"', raw_response)
        summary_match = re.search(r'"summary":\s*"([^"]+)"', raw_response)
        category_match = re.search(r'"category":\s*"([^"]+)"', raw_response)

        title = title_match.group(1).strip() if title_match else ""
        if not title or title.lower() in ["untitled", "untitled document", "untitled_document"]:
            title = default_title

        summary = summary_match.group(1) if summary_match else "No summary generated."
        category = category_match.group(1) if category_match else "General"

        return {
            "suggested_title": title,
            "summary": summary,
            "category": category,
            "tags": ["AI-Ingested"]
        }
