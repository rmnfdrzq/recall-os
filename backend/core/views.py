import os
import sys
import logging
import json
import re
import tempfile
from PyPDF2 import PdfReader
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404

logger = logging.getLogger(__name__)

SUPPORTED_GROQ_MODELS = [
    {
        "name": "llama-3.1-8b-instant",
        "profile": "text",
        "description": "Default Groq text model for chat, RAG chunks, summaries, metadata, and categories.",
        "is_default": True,
    },
    {
        "name": "meta-llama/llama-4-scout-17b-16e-instruct",
        "profile": "vision",
        "description": "Groq vision model for images, scans, screenshots, and PDF processing.",
        "is_default": False,
    },
]

SUPPORTED_GROQ_MODEL_NAMES = [model["name"] for model in SUPPORTED_GROQ_MODELS]

SOURCE_REF_PATTERN = re.compile(r'\[S(\d+)\]')


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
        logger.warning("PDF page rendering for Groq vision failed: %s", exc)
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
    Retrieves semantic excerpts, constructs LLM prompt, queries Groq text model, and saves dialog logs.
    """
    permission_classes = [AllowAny]

    def post(self, request, session_id):
        session = get_object_or_404(ChatSession, pk=session_id)
        content = request.data.get('content', '').strip()

        if not content:
            return Response({"error": "Message content is required"}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Save user query message
        user_message = ChatMessage.objects.create(
            session=session,
            role='user',
            content=content
        )

        # 2. Retrieve Semantic Excerpts (RAG Context)
        context_chunks = []
        sources_by_ref = {}

        client_context = request.data.get('context_chunks') or []
        if client_context:
            for idx, item in enumerate(client_context[:24]):
                chunk_content = str(item.get('content') or item.get('text') or '').strip()
                if not chunk_content:
                    continue
                source_title = item.get('suggested_title') or item.get('filename') or 'Local document'
                source_ref = f"S{len(context_chunks) + 1}"
                context_chunks.append({
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
                sources_by_ref[source_ref] = {
                    "source_ref": source_ref,
                    "document_id": str(item.get('document_id') or ''),
                    "filename": item.get('filename') or source_title,
                    "suggested_title": source_title,
                    "chunk_index": item.get('chunk_index', idx),
                    "page_number": item.get('page_number'),
                    "section_title": item.get('section_title') or "Document",
                    "snippet": chunk_content[:150] + ("..." if len(chunk_content) > 150 else ""),
                }

        # 3. Construct contextual prompt
        context_str = ""
        if context_chunks:
            if client_context:
                context_str = "\n".join([
                    f"Source Ref: [{c['source_ref']}]\n"
                    f"Source Document: {c['title']} "
                    f"(Section: {c['section_title']}; Page: {c.get('page_number') or 'unknown'}; "
                    f"Chunk: {c['chunk_index']}; Type: {c['content_type']}; Reason: {c['reason']})\n"
                    f"Detected Entities: {json.dumps(c.get('entities') or {}, ensure_ascii=False)}\n"
                    f"Content Excerpt:\n{c['content']}\n"
                    f"---"
                    for c in context_chunks
                ])

        system_prompt = (
            "You are RecallOS AI, a personal knowledge workspace assistant.\n"
            "Use the retrieved personal document excerpts, their sections, pages, and detected entities to answer accurately.\n"
            "For list-style questions, consolidate facts across all supplied excerpts instead of answering from the first excerpt only.\n"
            "When the answer depends on documents, cite only the source refs that directly support the answer, using markers like [S1].\n"
            "Do not cite unused source refs. If a source was retrieved but did not support the answer, do not cite it.\n"
            "If the context is empty or does not contain enough info, clearly state that the local documents do not contain enough information before using general knowledge.\n"
            "Keep your formatting clean, structured in markdown, and highly readable.\n\n"
            f"Retrieved Context:\n{context_str}"
        )

        # 4. Generate LLM completion
        ai_response = generate_completion(content, system_prompt=system_prompt, stream=False, model_profile="text")
        cited_refs = extract_cited_source_refs(ai_response)
        sources = filter_sources_by_cited_refs(sources_by_ref, cited_refs)
        clean_ai_response = strip_source_ref_markers(ai_response)

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
