import base64
import json
import logging
import mimetypes
import os
import re

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
except ImportError:
    pass

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_TEXT_MODEL = "llama-3.1-8b-instant"
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
TEXT_MODEL_PROFILE = "text"
VISION_MODEL_PROFILE = "vision"
SUPPORTED_GROQ_MODEL_NAMES = [GROQ_TEXT_MODEL, GROQ_VISION_MODEL]


def _get_groq_api_key():
    return os.environ.get("GROQ_API_KEY", "").strip()


def _select_model(model_profile=TEXT_MODEL_PROFILE, model=None):
    if model in SUPPORTED_GROQ_MODEL_NAMES:
        return model
    if model_profile == VISION_MODEL_PROFILE:
        return os.environ.get("GROQ_VISION_MODEL", GROQ_VISION_MODEL)
    return os.environ.get("GROQ_TEXT_MODEL", GROQ_TEXT_MODEL)


def _groq_headers():
    api_key = _get_groq_api_key()
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _call_groq(messages, *, model_profile=TEXT_MODEL_PROFILE, model=None, temperature=0.3, max_tokens=2048):
    selected_model = _select_model(model_profile=model_profile, model=model)
    payload = {
        "model": selected_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    response = requests.post(GROQ_API_URL, headers=_groq_headers(), json=payload, timeout=120)
    if response.status_code >= 400:
        try:
            details = response.json()
        except Exception:
            details = response.text
        raise RuntimeError(f"Groq API error ({response.status_code}) for {selected_model}: {details}")

    data = response.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""


def generate_completion(prompt, system_prompt=None, stream=False, model=None, model_profile=TEXT_MODEL_PROFILE):
    """
    Generates a text response through Groq. The default profile is text and uses
    llama-3.1-8b-instant for ordinary chat, RAG chunks, summaries, and metadata.
    """
    if stream:
        raise NotImplementedError("Streaming Groq responses are not implemented for this API surface")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    return _call_groq(messages, model_profile=model_profile, model=model)


def bytes_to_data_url(data, filename=None, mime_type=None):
    detected_mime = mime_type or mimetypes.guess_type(filename or "")[0] or "application/octet-stream"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{detected_mime};base64,{encoded}"


def generate_vision_completion(prompt, image_data_urls, system_prompt=None):
    """
    Uses Groq's vision model for images, scans, screenshots, and rendered PDF pages.
    """
    if not image_data_urls:
        raise ValueError("At least one image is required for vision completion")

    content = [{"type": "text", "text": prompt}]
    for data_url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": content})
    return _call_groq(messages, model_profile=VISION_MODEL_PROFILE, temperature=0.2, max_tokens=4096)


def extract_text_from_images(image_data_urls, filename=None):
    system_prompt = (
        "You extract readable text and useful visual context from user documents. "
        "Return plain text only. Preserve headings, labels, table-like rows, and visible ordering. "
        "If the image has little text, describe the important visible content succinctly."
    )
    prompt = (
        f"File: {filename or 'visual document'}\n\n"
        "Extract all readable text from this image/screenshot/scan. Include a short description of important visual content if needed."
    )
    return generate_vision_completion(prompt, image_data_urls, system_prompt=system_prompt)


def clean_fallback_title(filename):
    if not filename:
        return "Untitled Document"
    name, _ = os.path.splitext(filename)
    cleaned = name.replace('_', ' ').replace('-', ' ').strip()
    return cleaned if cleaned else name


SUMMARY_PLACEHOLDERS = {
    "",
    "no summary generated",
    "no summary generated.",
    "no summary synthesized",
    "no summary synthesized.",
    "n/a",
    "none",
    "null",
}


def is_missing_summary(summary):
    if summary is None:
        return True

    normalized = str(summary).strip().lower()
    return normalized in SUMMARY_PLACEHOLDERS or normalized.startswith("error ")


def normalize_for_copy_check(value):
    return re.sub(r"[^a-z0-9а-яё]+", " ", value or "", flags=re.IGNORECASE).strip().lower()


def summary_looks_copied_from_source(summary, document_text):
    summary_norm = normalize_for_copy_check(summary)
    source_norm = normalize_for_copy_check(document_text)

    if len(summary_norm) < 60 or not source_norm:
        return False

    source_prefix = source_norm[:max(len(summary_norm) + 120, 300)]
    return source_prefix.startswith(summary_norm)


def clean_generated_summary(raw_summary, max_length=700):
    summary = (raw_summary or "").strip()
    if is_missing_summary(summary):
        return ""

    if summary.startswith("```"):
        summary = re.sub(r"^```[a-zA-Z]*\s*", "", summary)
        summary = re.sub(r"\s*```$", "", summary)

    summary = summary.strip().strip('"').strip("'").strip()
    summary = re.sub(r"^(summary|ai summary)\s*:\s*", "", summary, flags=re.IGNORECASE)
    summary = re.sub(r"\s+", " ", summary).strip()

    if is_missing_summary(summary):
        return ""

    if len(summary) > max_length:
        summary = summary[:max_length - 3].rstrip() + "..."

    return summary


def generate_document_summary(document_text, fallback_title=None, model_profile=TEXT_MODEL_PROFILE):
    text = re.sub(r'\s+', ' ', document_text or '').strip()
    if not text:
        return ""

    title_hint = clean_fallback_title(fallback_title)
    system_prompt = (
        "You write concise document summaries for a local knowledge workspace. "
        "Return only a short high-level summary in 2-3 sentences. "
        "Do not quote the source text, do not copy the opening paragraph, and do not use bullet points."
    )
    prompt = (
        f"Document title hint: {title_hint}\n\n"
        "Summarize what this document is about and what its main useful information is:\n\n"
        f"{text[:6000]}"
    )

    raw_summary = generate_completion(prompt, system_prompt=system_prompt, model_profile=model_profile)
    summary = clean_generated_summary(raw_summary)
    if summary_looks_copied_from_source(summary, text):
        return ""
    return summary


def clean_generated_category(raw_category):
    category = (raw_category or "").strip()
    if not category:
        return "General"

    if category.startswith("```"):
        category = re.sub(r"^```[a-zA-Z]*\s*", "", category)
        category = re.sub(r"\s*```$", "", category)

    category = category.strip().strip('"').strip("'").strip()
    try:
        parsed = json.loads(category)
        if isinstance(parsed, dict):
            category = str(parsed.get("category") or parsed.get("label") or "").strip()
        elif isinstance(parsed, str):
            category = parsed.strip()
    except Exception:
        pass

    category = re.sub(r"^(category|label)\s*:\s*", "", category, flags=re.IGNORECASE)
    category = re.sub(r"[^A-Za-zА-Яа-яЁё0-9 &/-]+", " ", category)
    category = re.sub(r"\s+", " ", category).strip()
    if not category:
        return "General"

    words = category.split()
    if len(words) > 3:
        category = " ".join(words[:3])
    return category[:40]


def generate_document_category(document_text, summary=None, fallback_title=None, model_profile=TEXT_MODEL_PROFILE):
    text = re.sub(r'\s+', ' ', document_text or '').strip()
    summary_text = re.sub(r'\s+', ' ', summary or '').strip()
    if not text and not summary_text:
        return "General"

    title_hint = clean_fallback_title(fallback_title)
    system_prompt = (
        "You classify documents for a knowledge library. "
        "Return only one short neutral category label, 1-3 words. "
        "Examples: Technology, Finance, Legal, Health, Education, Resume, Research, Product, General. "
        "Do not return JSON, markdown, punctuation, or explanations."
    )
    prompt = (
        f"Document title hint: {title_hint}\n"
        f"AI summary: {summary_text or 'Unavailable'}\n\n"
        "Document content excerpts from processed chunks:\n"
        f"{text[:5000]}\n\n"
        "Best category label:"
    )

    raw_category = generate_completion(prompt, system_prompt=system_prompt, model_profile=model_profile)
    return clean_generated_category(raw_category)


def extract_metadata(document_text, fallback_title=None, model_profile=TEXT_MODEL_PROFILE):
    default_title = clean_fallback_title(fallback_title)
    system_prompt = (
        "You are an AI knowledge cataloging assistant. You analyze raw document content and extract structured metadata.\n"
        "You MUST return ONLY a raw valid JSON object. No markdown wrapping, no explanation, no backticks.\n"
        "Structure template:\n"
        "{\n"
        "  \"suggested_title\": \"Short clear title of the text\",\n"
        "  \"summary\": \"Concise 3-line summary explaining the core message\",\n"
        "  \"category\": \"Single-word general category (e.g. Technology, Finance, Cooking, Health, Engineering)\",\n"
        "  \"tags\": [\"tag1\", \"tag2\", \"tag3\"]\n"
        "}"
    )

    text_sample = document_text[:3000]
    prompt = f"Analyze the following document content and extract metadata in the exact JSON format specified:\n\n{text_sample}"
    raw_response = generate_completion(prompt, system_prompt=system_prompt, model_profile=model_profile)

    try:
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

        summary = metadata.get("summary", "")
        if is_missing_summary(summary) or summary_looks_copied_from_source(summary, document_text):
            summary = generate_document_summary(document_text, fallback_title, model_profile=model_profile)

        tags = metadata.get("tags", [])
        if not isinstance(tags, list) or not tags:
            tags = ["AI-Ingested"]

        return {
            "suggested_title": suggested_title,
            "summary": summary,
            "category": metadata.get("category", "General"),
            "tags": tags
        }
    except Exception as e:
        logger.warning(f"Groq structured JSON metadata extraction failed, falling back to regex. Raw: {raw_response}. Error: {e}")

        title_match = re.search(r'"suggested_title":\s*"([^"]+)"', raw_response)
        summary_match = re.search(r'"summary":\s*"([^"]+)"', raw_response)
        category_match = re.search(r'"category":\s*"([^"]+)"', raw_response)

        title = title_match.group(1).strip() if title_match else ""
        if not title or title.lower() in ["untitled", "untitled document", "untitled_document"]:
            title = default_title

        summary = summary_match.group(1).strip() if summary_match else ""
        if is_missing_summary(summary) or summary_looks_copied_from_source(summary, document_text):
            summary = generate_document_summary(document_text, fallback_title, model_profile=model_profile)
        category = category_match.group(1) if category_match else "General"

        return {
            "suggested_title": title,
            "summary": summary,
            "category": category,
            "tags": ["AI-Ingested"]
        }
