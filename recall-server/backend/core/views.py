import os
import sys
import logging
import json
import re
import tempfile
import uuid
from PyPDF2 import PdfReader
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404
from django.core import signing

logger = logging.getLogger(__name__)

SUPPORTED_GROQ_MODELS = [
    {
        "name": "meta-llama/llama-4-scout-17b-16e-instruct",
        "profile": "universal",
        "description": "Universal Groq model for chat, RAG chunks, summaries, metadata, categories, images, scans, screenshots, and PDF processing.",
        "is_default": True,
    },
]

SOURCE_REF_PATTERN = re.compile(r'\[S(\d+)\]')
METADATA_INVENTORY_QUERY_MODES = {"library_inventory", "extension_filter", "metadata_filter"}
DETERMINISTIC_METADATA_QUERY_MODES = METADATA_INVENTORY_QUERY_MODES
LLM_ROUTED_QUERY_MODE = "llm_routed"
LLM_ROUTER_QUERY_MODES = {
    "library_inventory",
    "extension_filter",
    "metadata_filter",
    "document_lookup",
    "semantic_lookup",
    "compare",
    "summarize",
    "aggregate_all",
}
TOOL_CALL_MAX_AGE_SECONDS = 600


def extract_cited_source_refs(answer_text):
    seen = set()
    refs = []
    for match in SOURCE_REF_PATTERN.finditer(answer_text or ''):
        ref = f"S{match.group(1)}"
        if ref not in seen:
            seen.add(ref)
            refs.append(ref)
    return refs


def strip_source_ref_markers(answer_text):
    cleaned = SOURCE_REF_PATTERN.sub('', answer_text or '')
    cleaned = re.sub(r'[ \t]+([.,;:!?])', r'\1', cleaned)
    cleaned = re.sub(r' {2,}', ' ', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def filter_sources_by_cited_refs(sources_by_ref, cited_refs):
    filtered_sources = []
    seen_documents = set()
    for ref in cited_refs:
        source = sources_by_ref.get(ref)
        if not source:
            continue
        document_key = source.get('document_id') or source.get('filename') or ref
        if document_key in seen_documents:
            continue
        seen_documents.add(document_key)
        filtered_sources.append(source)
    return filtered_sources


def unique_sources_from_candidates(candidate_sources_by_ref, limit=None):
    filtered_sources = []
    seen_documents = set()
    for source in candidate_sources_by_ref.values():
        document_key = source.get('document_id') or source.get('filename') or source.get('source_ref')
        if document_key in seen_documents:
            continue
        seen_documents.add(document_key)
        filtered_sources.append(source)
        if limit is not None and len(filtered_sources) >= limit:
            break
    return filtered_sources


def filter_sources_by_document_ids(candidate_sources_by_ref, document_ids):
    if not document_ids:
        return []
    wanted = [str(document_id) for document_id in document_ids if document_id]
    wanted_set = set(wanted)
    sources_by_document_id = {}
    for source in candidate_sources_by_ref.values():
        document_id = str(source.get('document_id') or '')
        if document_id and document_id in wanted_set and document_id not in sources_by_document_id:
            sources_by_document_id[document_id] = source
    return [
        sources_by_document_id[document_id]
        for document_id in wanted
        if document_id in sources_by_document_id
    ]


def resolve_answer_sources(candidate_sources_by_ref, cited_refs, query_mode, used_document_ids=None):
    structured_sources = filter_sources_by_document_ids(candidate_sources_by_ref, used_document_ids or [])
    if structured_sources:
        return structured_sources

    if is_metadata_inventory_mode(query_mode):
        return unique_sources_from_candidates(candidate_sources_by_ref, limit=50)

    cited_sources = filter_sources_by_cited_refs(candidate_sources_by_ref, cited_refs)
    if cited_sources:
        return cited_sources

    fallback_candidates = unique_sources_from_candidates(candidate_sources_by_ref)
    if len(fallback_candidates) == 1:
        return fallback_candidates
    return []


def parse_structured_llm_response(raw_response):
    raw_text = str(raw_response or '').strip()
    if not raw_text:
        return {
            "answer": "",
            "used_document_ids": [],
            "confidence": "",
            "missing_information": [],
        }

    json_text = raw_text
    fenced = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text, re.IGNORECASE)
    if fenced:
        json_text = fenced.group(1).strip()

    try:
        data = json.loads(json_text)
    except Exception:
        data = None

    if not isinstance(data, dict):
        return {
            "answer": raw_text,
            "used_document_ids": [],
            "confidence": "",
            "missing_information": [],
        }

    answer = data.get("answer") or data.get("content") or data.get("message") or ""
    used_document_ids = data.get("used_document_ids") or data.get("usedDocumentIds") or []
    if not isinstance(used_document_ids, list):
        used_document_ids = []
    missing_information = data.get("missing_information") or data.get("missingInformation") or []
    if not isinstance(missing_information, list):
        missing_information = []

    return {
        "answer": str(answer),
        "used_document_ids": [str(document_id) for document_id in used_document_ids if document_id],
        "confidence": str(data.get("confidence") or ""),
        "missing_information": missing_information,
    }


def parse_json_object_response(raw_response):
    raw_text = str(raw_response or '').strip()
    if not raw_text:
        return None
    fenced = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text, re.IGNORECASE)
    json_text = fenced.group(1).strip() if fenced else raw_text
    try:
        data = json.loads(json_text)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def default_llm_route():
    return {
        "query_mode": "semantic_lookup",
        "scope": {
            "source": "semantic_search",
            "document_ids": [],
            "filters": {},
        },
        "retrieval": {
            "strategy": "broad_vector_search",
            "needs_semantic_context": True,
        },
        "confidence": "low",
    }


def parse_query_intent_response(raw_response):
    data = parse_json_object_response(raw_response)
    if not data:
        return default_llm_route()

    query_mode = str(data.get("query_mode") or data.get("queryMode") or "").strip()
    if query_mode not in LLM_ROUTER_QUERY_MODES:
        query_mode = "semantic_lookup"

    filters = data.get("filters") if isinstance(data.get("filters"), dict) else {}
    extension = filters.get("extension") or data.get("extension")
    if extension:
        normalized_extension = str(extension).lower().lstrip(".").strip()
        if normalized_extension:
            filters = {**filters, "extension": normalized_extension}

    document_ids = data.get("document_ids") or data.get("documentIds") or []
    if not isinstance(document_ids, list):
        document_ids = []
    document_ids = [str(document_id) for document_id in document_ids if document_id]

    if query_mode in METADATA_INVENTORY_QUERY_MODES:
        source = "library_metadata"
        strategy = "metadata_inventory"
        needs_semantic_context = False
    elif document_ids:
        source = "explicit_document_reference"
        strategy = "scoped_vector_search"
        needs_semantic_context = True
    else:
        source = "semantic_search"
        strategy = "broad_vector_search"
        needs_semantic_context = data.get("needs_semantic_context", True)

    return {
        "query_mode": query_mode,
        "scope": {
            "source": source,
            "document_ids": document_ids,
            "filters": filters,
        },
        "retrieval": {
            "strategy": strategy,
            "needs_semantic_context": bool(needs_semantic_context),
        },
        "confidence": str(data.get("confidence") or ""),
    }


def normalize_inventory_items(items):
    normalized_items = []
    if not isinstance(items, list):
        return normalized_items
    for item in items:
        if not isinstance(item, dict):
            continue
        normalized_items.append({
            **item,
            "reason": item.get("reason") or "library_inventory",
            "section_title": item.get("section_title") or "Library Inventory",
            "content_type": item.get("content_type") or "document_metadata",
            "chunk_index": item.get("chunk_index", 0),
        })
    return normalized_items


def apply_llm_route_to_inventory(route, inventory_items):
    scope = route.get("scope") if isinstance(route, dict) else {}
    filters = scope.get("filters") if isinstance(scope, dict) and isinstance(scope.get("filters"), dict) else {}
    document_ids = scope.get("document_ids") if isinstance(scope, dict) else []
    wanted_document_ids = {str(document_id) for document_id in document_ids or [] if document_id}
    extension = str(filters.get("extension") or "").lower().lstrip(".").strip()

    filtered_items = []
    for item in normalize_inventory_items(inventory_items):
        document_id = str(item.get("document_id") or "")
        filename = str(item.get("filename") or "").lower()
        if wanted_document_ids and document_id not in wanted_document_ids:
            continue
        if extension and not filename.endswith(f".{extension}"):
            continue
        filtered_items.append(item)

    resolved_document_ids = [str(item.get("document_id")) for item in filtered_items if item.get("document_id")]
    resolved_route = {
        **route,
        "scope": {
            **(scope if isinstance(scope, dict) else {}),
            "source": "library_metadata",
            "document_ids": resolved_document_ids,
            "filters": filters if isinstance(filters, dict) else {},
        },
        "retrieval": {
            **(route.get("retrieval") if isinstance(route.get("retrieval"), dict) else {}),
            "strategy": "metadata_inventory",
            "needs_semantic_context": False,
        },
    }
    return filtered_items, resolved_route


def filter_context_by_document_ids(context_items, document_ids):
    if not document_ids:
        return context_items
    wanted = {str(document_id) for document_id in document_ids if document_id}
    return [
        item for item in context_items
        if isinstance(item, dict) and str(item.get("document_id") or "") in wanted
    ]


def build_query_intent_prompt(content, inventory_items, client_scope):
    inventory_lines = []
    for item in normalize_inventory_items(inventory_items)[:80]:
        inventory_lines.append(
            "- "
            f"document_id={item.get('document_id') or ''}; "
            f"filename={item.get('filename') or ''}; "
            f"title={item.get('suggested_title') or item.get('filename') or ''}"
        )

    return (
        "Classify the user's request for a personal RAG/second-brain chat. "
        "The user can write in any language and with any wording.\n"
        "Return a valid JSON object only, without markdown fences. Schema: "
        "{\"query_mode\": \"library_inventory\"|\"extension_filter\"|\"metadata_filter\"|"
        "\"document_lookup\"|\"semantic_lookup\"|\"compare\"|\"summarize\"|\"aggregate_all\", "
        "\"document_ids\": string[], \"filters\": object, "
        "\"needs_semantic_context\": boolean, \"confidence\": \"high\"|\"medium\"|\"low\"}.\n"
        "Use metadata modes when the user asks what files/documents exist, asks for files by extension/type, "
        "or asks to filter/list library items by metadata. Use semantic modes when the user asks about content. "
        "Respect explicit user-selected scope if present, but still classify intent from the natural language.\n\n"
        f"User request:\n{content}\n\n"
        f"Explicit user scope:\n{json.dumps(client_scope or {}, ensure_ascii=False)}\n\n"
        f"Current library inventory:\n{chr(10).join(inventory_lines) or 'No inventory items supplied.'}"
    )


def route_query_with_llm(content, inventory_items, client_scope=None):
    router_prompt = build_query_intent_prompt(content, inventory_items, client_scope or {})
    raw_route = generate_completion(router_prompt, system_prompt=None, stream=False, model_profile="text")
    route = parse_query_intent_response(raw_route)

    explicit_ids = []
    if isinstance(client_scope, dict) and client_scope.get("source") == "explicit_user_scope":
        explicit_ids = client_scope.get("document_ids") or []
    if explicit_ids and route["query_mode"] not in METADATA_INVENTORY_QUERY_MODES:
        route["scope"]["source"] = "explicit_user_scope"
        route["scope"]["document_ids"] = [str(document_id) for document_id in explicit_ids if document_id]
        route["retrieval"]["strategy"] = "scoped_vector_search"

    return route


def build_agentic_tool_request(content, route, user_message_id, session_id=None):
    query_mode = route.get("query_mode")
    scope = route.get("scope") if isinstance(route.get("scope"), dict) else {}
    filters = scope.get("filters") if isinstance(scope.get("filters"), dict) else {}
    document_ids = scope.get("document_ids") if isinstance(scope.get("document_ids"), list) else []

    if is_metadata_inventory_mode(query_mode):
        tool = "list_library"
        args = {
            "filters": filters,
            "document_ids": document_ids,
            "limit": 200,
        }
    else:
        tool = "search_local_documents"
        args = {
            "query": content,
            "filters": filters,
            "document_ids": document_ids,
            "limit": 50,
        }

    tool_call_id = f"tool-{uuid.uuid4()}"
    token_payload = {
        "tool_call_id": tool_call_id,
        "tool": tool,
        "user_message_id": user_message_id,
        "session_id": str(session_id) if session_id is not None else None,
    }

    return {
        "type": "tool_request",
        "tool_call_id": tool_call_id,
        "tool_call_token": signing.dumps(token_payload, salt="recallos-chat-tool-call"),
        "tool": tool,
        "args": args,
        "route": route,
        "user_message_id": user_message_id,
    }


def is_tool_result_request(request_data):
    return get_structured_query_mode(request_data) == "tool_result" and isinstance(request_data.get("tool_result"), dict)


def route_from_tool_result(tool_result):
    route = tool_result.get("route") if isinstance(tool_result, dict) else None
    if not isinstance(route, dict):
        return default_llm_route()
    query_mode = route.get("query_mode")
    if query_mode not in LLM_ROUTER_QUERY_MODES:
        return default_llm_route()
    return {
        "query_mode": query_mode,
        "scope": route.get("scope") if isinstance(route.get("scope"), dict) else {},
        "retrieval": route.get("retrieval") if isinstance(route.get("retrieval"), dict) else {},
        "confidence": str(route.get("confidence") or ""),
    }


def verify_tool_result_request(request_data, tool_result, session_id):
    token = request_data.get("tool_call_token") or tool_result.get("tool_call_token")
    if not token:
        return None, "Tool call token is required"
    try:
        payload = signing.loads(
            token,
            salt="recallos-chat-tool-call",
            max_age=TOOL_CALL_MAX_AGE_SECONDS,
        )
    except signing.BadSignature:
        return None, "Invalid or expired tool call token"

    if str(payload.get("tool_call_id")) != str(tool_result.get("tool_call_id")):
        return None, "Tool call id does not match the signed token"
    if str(payload.get("tool")) != str(tool_result.get("tool")):
        return None, "Tool name does not match the signed token"
    if str(payload.get("user_message_id")) != str(request_data.get("user_message_id")):
        return None, "User message id does not match the signed token"
    if payload.get("session_id") is not None and str(payload.get("session_id")) != str(session_id):
        return None, "Session id does not match the signed token"

    return payload, None


def is_deterministic_metadata_answer_mode(query_mode):
    return query_mode in DETERMINISTIC_METADATA_QUERY_MODES


def source_display_name(source):
    filename = source.get("filename") or source.get("suggested_title") or "Document"
    title = source.get("suggested_title") or filename
    if title and title != filename:
        return f"{filename} — {title}"
    return filename


def detect_user_language(text):
    source = str(text or "")
    cyrillic_count = len(re.findall(r'[А-Яа-яЁё]', source))
    latin_count = len(re.findall(r'[A-Za-z]', source))
    return "ru" if cyrillic_count > latin_count else "en"


def build_deterministic_metadata_answer(query_mode, scope, candidate_sources_by_ref, user_language="ru"):
    sources = unique_sources_from_candidates(candidate_sources_by_ref, limit=50)
    filters = scope.get("filters") if isinstance(scope, dict) else {}
    extension = filters.get("extension") if isinstance(filters, dict) else None
    is_english = user_language == "en"

    if not sources:
        if extension:
            if is_english:
                return f"No .{extension} documents were found in the library."
            return f"В библиотеке не найдено документов с расширением .{extension}."
        if is_english:
            return "No documents were found in the library."
        return "В библиотеке не найдено документов."

    count = len(sources)
    if is_english:
        noun = "document" if count == 1 else "documents"
        if query_mode == "extension_filter" and extension:
            header = f"Found {count} .{extension} {noun}:"
        else:
            header = f"Found {count} {noun} in the library:"
    else:
        if query_mode == "extension_filter" and extension:
            header = f"Найдено {count} .{extension} документа:"
        else:
            header = f"В библиотеке найдено {count} документов:"

    lines = [header]
    for index, source in enumerate(sources, start=1):
        lines.append(f"{index}. {source_display_name(source)}")
    return "\n".join(lines)


def has_library_inventory_context(client_context):
    return any(
        str(item.get('reason') or '').strip() == 'library_inventory'
        for item in client_context
        if isinstance(item, dict)
    )


def get_structured_query_mode(request_data):
    return str(request_data.get('query_mode') or '').strip()


def is_metadata_inventory_mode(query_mode):
    return query_mode in METADATA_INVENTORY_QUERY_MODES


def get_structured_client_context(request_data):
    return request_data.get('context_chunks') or []


def build_source_pipeline(client_context, *, is_library_inventory):
    context_for_model = []
    candidate_sources_by_ref = {}
    total_context_chars = 0
    context_limit = 50 if is_library_inventory else 10
    context_char_limit = 12000 if is_library_inventory else 6500

    for idx, item in enumerate(client_context[:context_limit]):
        chunk_content = trim_context_excerpt(str(item.get('content') or item.get('text') or ''))
        if not chunk_content:
            continue
        if total_context_chars + len(chunk_content) > context_char_limit:
            remaining = context_char_limit - total_context_chars
            if remaining < 300:
                break
            chunk_content = trim_context_excerpt(chunk_content, max_chars=remaining)
        source_title = item.get('suggested_title') or item.get('filename') or 'Local document'
        source_ref = f"S{len(context_for_model) + 1}"
        context_for_model.append({
            "source_ref": source_ref,
            "title": source_title,
            "chunk_index": item.get('chunk_index', idx),
            "page_number": item.get('page_number'),
            "section_title": item.get('section_title') or "Document",
            "content_type": item.get('content_type') or "paragraph",
            "reason": item.get('reason') or "retrieval",
            "entities": item.get('entities') or {},
            "content": chunk_content,
        })
        total_context_chars += len(chunk_content)
        candidate_sources_by_ref[source_ref] = {
            "source_ref": source_ref,
            "document_id": str(item.get('document_id') or ''),
            "filename": item.get('filename') or source_title,
            "suggested_title": source_title,
            "chunk_index": item.get('chunk_index', idx),
            "page_number": item.get('page_number'),
            "section_title": item.get('section_title') or "Document",
            "snippet": chunk_content[:150] + ("..." if len(chunk_content) > 150 else ""),
        }

    return {
        "context_for_model": context_for_model,
        "candidate_sources_by_ref": candidate_sources_by_ref,
    }


def trim_context_excerpt(text, max_chars=900):
    cleaned = re.sub(r'\s+', ' ', text or '').strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].rsplit(' ', 1)[0].rstrip() + "..."

# Import path patches to load ai-services modules
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_ROOT = os.path.dirname(BASE_DIR)
sys.path.append(os.path.join(WORKSPACE_ROOT, 'ai-services'))

from chunker import semantic_chunk_text
from groq_client import (
    VISION_MODEL_PROFILE,
    bytes_to_data_url,
    extract_text_from_images,
    generate_completion,
    extract_metadata,
    generate_document_category,
    generate_document_summary,
)
from ollama_client import OLLAMA_EMBEDDING_MODEL, generate_embeddings
from ollama_llm_client import OLLAMA_LLM_MODEL
from .models import ChatSession, ChatMessage
from .serializers import (
    ChatSessionSerializer,
    ChatSessionDetailSerializer,
    ChatMessageSerializer
)


def infer_file_type(filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext in ['.png', '.jpg', '.jpeg', '.webp']:
        return 'image'
    if ext == '.pdf':
        return 'pdf'
    if ext in ['.md', '.markdown']:
        return 'markdown'
    return 'text'


def render_pdf_pages_to_data_urls(pdf_bytes, max_pages=3):
    try:
        import fitz
    except Exception as exc:
        logger.warning("PyMuPDF is unavailable; PDF vision rendering is disabled: %s", exc)
        return []

    data_urls = []
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_index in range(min(len(document), max_pages)):
            page = document.load_page(page_index)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
            data_urls.append(bytes_to_data_url(pixmap.tobytes("png"), filename=f"page-{page_index + 1}.png", mime_type="image/png"))
        document.close()
    except Exception as exc:
        logger.warning("PDF page rendering for Groq visual extraction failed: %s", exc)
    return data_urls


def extract_text_from_pdf_bytes(pdf_bytes):
    pages_text = []
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            temp_path = tmp.name
        try:
            reader = PdfReader(temp_path)
            for page_index, page in enumerate(reader.pages, start=1):
                page_content = page.extract_text()
                if page_content:
                    pages_text.append(f"[Page {page_index}]\n\n{page_content}")
        finally:
            os.unlink(temp_path)
    except Exception as exc:
        logger.warning("Digital PDF text extraction failed: %s", exc)

    return "\n\n".join(pages_text).strip()


def extract_uploaded_file_text(uploaded_file, filename):
    ext = os.path.splitext(filename)[1].lower()

    if ext in ['.txt', '.md', '.markdown', '.py', '.js', '.ts', '.jsx', '.tsx', '.json', '.csv', '.html', '.css', '.rs', '.go', '.yaml', '.yml']:
        return uploaded_file.read().decode('utf-8', errors='ignore'), "text"

    file_bytes = uploaded_file.read()

    if ext in ['.png', '.jpg', '.jpeg', '.webp']:
        data_url = bytes_to_data_url(file_bytes, filename=filename)
        return f"[Page 1]\n\n{extract_text_from_images([data_url], filename=filename)}", VISION_MODEL_PROFILE

    if ext == '.pdf':
        rendered_pages = render_pdf_pages_to_data_urls(file_bytes)
        if rendered_pages:
            vision_text = extract_text_from_images(rendered_pages, filename=filename).strip()
            if vision_text:
                return vision_text, VISION_MODEL_PROFILE

        extracted_text = extract_text_from_pdf_bytes(file_bytes)
        if extracted_text:
            return extracted_text, VISION_MODEL_PROFILE
        return "[PDF] No readable content could be extracted from this PDF.", VISION_MODEL_PROFILE

    return file_bytes.decode('utf-8', errors='ignore'), "text"


class StatelessDocumentProcessView(APIView):
    """
    Transient server fallback for client-first ingestion.
    Extracts text and metadata from an uploaded file, returns JSON, and persists nothing.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({"error": "File is required"}, status=status.HTTP_400_BAD_REQUEST)

        filename = uploaded_file.name
        file_type = infer_file_type(filename)

        try:
            extracted_text, model_profile = extract_uploaded_file_text(uploaded_file, filename)
            extracted_text = extracted_text.strip()
            if not extracted_text:
                return Response({"error": "No text could be extracted from the file"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

            chunks = semantic_chunk_text(extracted_text, chunk_size=1000, overlap=200)
            metadata = extract_metadata(extracted_text, fallback_title=filename, model_profile=model_profile)

            return Response({
                "filename": filename,
                "file_type": file_type,
                "text": extracted_text,
                "chunks": chunks,
                "suggested_title": metadata.get("suggested_title") or filename,
                "summary": metadata.get("summary", ""),
                "category": metadata.get("category", "General"),
                "tags": metadata.get("tags", ["AI-Ingested"]),
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Transient document processing failed for %s: %s", filename, e)
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StatelessDocumentSummaryView(APIView):
    """
    Transient summary generation for client-first ingestion.
    Receives already extracted document text, returns AI summary, and persists nothing.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        text = str(request.data.get('text') or '').strip()
        filename = str(request.data.get('filename') or '').strip() or None
        model_profile = str(request.data.get('model_profile') or request.data.get('modelProfile') or 'text').strip()

        if not text:
            return Response({"error": "Document text is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            summary = generate_document_summary(text, fallback_title=filename, model_profile=model_profile)
            if not summary:
                return Response({"error": "AI summary could not be generated"}, status=status.HTTP_502_BAD_GATEWAY)
            return Response({"summary": summary}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Transient document summary generation failed for %s: %s", filename or "untitled", e)
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StatelessDocumentCategoryView(APIView):
    """
    Transient category generation for client-first ingestion.
    Receives already extracted chunks plus an AI summary, returns a library label, and persists nothing.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        filename = str(request.data.get('filename') or '').strip() or None
        summary = str(request.data.get('summary') or '').strip()
        chunks = request.data.get('chunks') or []
        model_profile = str(request.data.get('model_profile') or request.data.get('modelProfile') or 'text').strip()

        chunk_texts = []
        if isinstance(chunks, list):
            for item in chunks[:24]:
                if isinstance(item, str):
                    content = item
                else:
                    content = str(item.get('content') or item.get('text') or '')
                content = content.strip()
                if content:
                    chunk_texts.append(content)

        text = "\n\n".join(chunk_texts)
        if not text and not summary:
            return Response({"error": "Summary or chunks are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            category = generate_document_category(text, summary=summary, fallback_title=filename, model_profile=model_profile)
            return Response({"category": category or "General"}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Transient document category generation failed for %s: %s", filename or "untitled", e)
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ChatSessionViewSet(viewsets.ModelViewSet):
    """
    Handles ChatSession conversation channels.
    """
    permission_classes = [AllowAny]

    def get_queryset(self):
        return ChatSession.objects.all()

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ChatSessionDetailSerializer
        return ChatSessionSerializer

    def perform_create(self, serializer):
        serializer.save()


class ChatMessageCreateView(APIView):
    """
    Contextual RAG Chat View.
    Retrieves semantic excerpts, constructs LLM prompt, queries the universal Groq model, and saves dialog logs.
    """
    permission_classes = [AllowAny]

    def post(self, request, session_id):
        session = get_object_or_404(ChatSession, pk=session_id)
        content = request.data.get('content', '').strip()

        if not content:
            return Response({"error": "Message content is required"}, status=status.HTTP_400_BAD_REQUEST)

        tool_result = request.data.get("tool_result") if is_tool_result_request(request.data) else None
        if tool_result:
            _, tool_error = verify_tool_result_request(request.data, tool_result, session.id)
            if tool_error:
                return Response({"error": tool_error}, status=status.HTTP_400_BAD_REQUEST)
            user_message = None
            user_message_id = request.data.get("user_message_id")
            if user_message_id:
                user_message = session.messages.filter(pk=user_message_id, role="user").first()
            if not user_message:
                return Response({"error": "Tool result is not linked to a user message in this session"}, status=status.HTTP_400_BAD_REQUEST)
        else:
            user_message = ChatMessage.objects.create(
                session=session,
                role='user',
                content=content
            )

        # 2. Let the backend LLM router classify the user request from raw text, then ask the client for local data.
        client_query_mode = get_structured_query_mode(request.data)
        client_scope = request.data.get('scope') if isinstance(request.data.get('scope'), dict) else {}
        if tool_result:
            route = route_from_tool_result(tool_result)
            client_context = tool_result.get("items") if isinstance(tool_result.get("items"), list) else []
        elif client_query_mode == LLM_ROUTED_QUERY_MODE or not client_query_mode:
            route = route_query_with_llm(content, [], client_scope=client_scope)
            return Response(
                build_agentic_tool_request(content, route, user_message.id, session_id=session.id),
                status=status.HTTP_202_ACCEPTED,
            )
        else:
            route = {
                "query_mode": client_query_mode,
                "scope": client_scope,
                "retrieval": request.data.get('retrieval') if isinstance(request.data.get('retrieval'), dict) else {},
                "confidence": "",
            }
            client_context = get_structured_client_context(request.data)

        query_mode = route["query_mode"]
        scope = route["scope"]
        retrieval = route["retrieval"]

        if is_metadata_inventory_mode(query_mode):
            client_context, route = apply_llm_route_to_inventory(route, client_context)
            query_mode = route["query_mode"]
            scope = route["scope"]
            retrieval = route["retrieval"]
        elif not tool_result:
            client_context = get_structured_client_context(request.data)
            client_context = filter_context_by_document_ids(client_context, scope.get("document_ids") or [])
        else:
            client_context = filter_context_by_document_ids(client_context, scope.get("document_ids") or [])

        is_library_inventory = is_metadata_inventory_mode(query_mode) or has_library_inventory_context(client_context)
        source_pipeline = build_source_pipeline(client_context, is_library_inventory=is_library_inventory)
        context_for_model = source_pipeline["context_for_model"]
        candidate_sources_by_ref = source_pipeline["candidate_sources_by_ref"]

        # 3. Construct contextual prompt
        context_str = ""
        if context_for_model:
            if client_context:
                context_str = "\n".join([
                    f"Source Ref: [{c['source_ref']}]\n"
                    f"Source Document: {c['title']} "
                    f"(Section: {c['section_title']}; Page: {c.get('page_number') or 'unknown'}; "
                    f"Chunk: {c['chunk_index']}; Type: {c['content_type']}; Reason: {c['reason']})\n"
                    f"Document ID: {candidate_sources_by_ref.get(c['source_ref'], {}).get('document_id') or 'unknown'}\n"
                    f"Detected Entities: {json.dumps(c.get('entities') or {}, ensure_ascii=False)}\n"
                    f"Content Excerpt:\n{c['content']}\n"
                    f"---"
                    for c in context_for_model
                ])

        recent_messages = list(session.messages.order_by('-created_at')[:8])
        recent_messages.reverse()
        conversation_history = "\n".join([
            f"{message.role.capitalize()}: {trim_context_excerpt(message.content, max_chars=700)}"
            for message in recent_messages
            if not user_message or message.id != user_message.id
        ])

        library_inventory_instruction = (
            "If Retrieved Context contains Library Inventory items, treat them as the complete current library list. "
            "List every inventory item, do not rely on recent conversation to decide which files exist, "
            "and do not describe inventory files as merely previously discussed.\n"
            if is_library_inventory else ""
        )
        structured_output_instruction = (
            "Return a valid JSON object only, without markdown fences. "
            "The JSON schema is: "
            "{\"answer\": string, \"used_document_ids\": string[], \"confidence\": \"high\"|\"medium\"|\"low\", "
            "\"missing_information\": string[]}. "
            "Set used_document_ids to only the document_id values that directly support the final answer. "
            "If no document directly supports the final answer, use an empty array.\n"
        )
        structured_contract_context = (
            f"Query Mode: {query_mode or 'legacy'}\n"
            f"Scope: {json.dumps(scope, ensure_ascii=False)}\n"
            f"Retrieval: {json.dumps(retrieval, ensure_ascii=False)}\n"
        )
        user_language = detect_user_language(content)
        language_instruction = (
            "Answer in English because the user's latest message is in English.\n"
            if user_language == "en"
            else "Отвечай на русском языке, потому что последнее сообщение пользователя написано на русском.\n"
        )

        system_prompt = (
            "You are RecallOS AI, a personal knowledge workspace assistant.\n"
            f"{language_instruction}"
            "Use the retrieved personal document excerpts, their sections, pages, and detected entities to answer accurately.\n"
            "Use the recent conversation history to resolve follow-up questions and pronouns.\n"
            "For list-style questions, consolidate facts across all supplied excerpts instead of answering from the first excerpt only.\n"
            f"{library_inventory_instruction}"
            "When the answer depends on documents, use only source refs that directly support the answer.\n"
            "Do not use unused source refs. If a source was retrieved but did not support the answer, do not include it in used_document_ids.\n"
            f"{structured_output_instruction}"
            "If the context is empty or does not contain enough info, clearly state that the local documents do not contain enough information before using general knowledge.\n"
            "Keep your formatting clean, structured in markdown, and highly readable.\n\n"
            f"Structured Request:\n{structured_contract_context}\n"
            f"Recent Conversation:\n{conversation_history or 'No previous messages.'}\n\n"
            f"Retrieved Context:\n{context_str or 'No retrieved document excerpts.'}"
        )

        # 4. Generate LLM completion
        try:
            if is_deterministic_metadata_answer_mode(query_mode):
                clean_ai_response = build_deterministic_metadata_answer(
                    query_mode=query_mode,
                    scope=scope,
                    candidate_sources_by_ref=candidate_sources_by_ref,
                    user_language=user_language,
                )
                sources = resolve_answer_sources(candidate_sources_by_ref, cited_refs=[], query_mode=query_mode)
            else:
                raw_ai_response = generate_completion(content, system_prompt=system_prompt, stream=False, model_profile="text")
                parsed_response = parse_structured_llm_response(raw_ai_response)
                ai_answer = parsed_response["answer"]
                cited_refs = extract_cited_source_refs(ai_answer)
                sources = resolve_answer_sources(
                    candidate_sources_by_ref,
                    cited_refs,
                    query_mode,
                    used_document_ids=parsed_response["used_document_ids"],
                )
                clean_ai_response = strip_source_ref_markers(ai_answer)
        except Exception as exc:
            logger.exception("Chat completion failed for session %s", session_id)
            sources = resolve_answer_sources(candidate_sources_by_ref, cited_refs=[], query_mode=query_mode)
            clean_ai_response = (
                "I could not generate a fresh AI answer right now because the language model provider "
                "returned a temporary error. Please try again in a few seconds."
            )

        # 5. Save assistant response message with sourced documents list
        assistant_message = ChatMessage.objects.create(
            session=session,
            role='assistant',
            content=clean_ai_response,
            sources=sources
        )

        # Update session timestamp to float to top of lists
        session.save()

        # Serialize and return
        serializer = ChatMessageSerializer(assistant_message)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class GroqModelListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        api_key_configured = bool(os.environ.get("GROQ_API_KEY", "").strip())
        return Response({
            "provider": "groq",
            "fallback_provider": "ollama",
            "fallback_model": os.environ.get("OLLAMA_LLM_MODEL", OLLAMA_LLM_MODEL),
            "api_key_configured": api_key_configured,
            "models": [
                {
                    "name": model["name"],
                    "profile": model["profile"],
                    "description": model["description"],
                    "installed": api_key_configured,
                    "is_default": model["is_default"],
                }
                for model in SUPPORTED_GROQ_MODELS
            ],
        })


class StatelessEmbeddingsView(APIView):
    """
    Stateless endpoint that generates embeddings for a batch of texts using local Ollama bge-m3.
    Persists absolutely no user files or vector results on the server.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        texts = request.data.get('texts')
        if not texts or not isinstance(texts, list):
            return Response({"error": "A list of 'texts' is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            embeddings = generate_embeddings(texts, model=OLLAMA_EMBEDDING_MODEL)
            return Response({
                "embeddings": embeddings
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Stateless embeddings batch generation failed")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
