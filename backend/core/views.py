import os
import sys
import logging
import json
import tempfile
import requests
from django.http import StreamingHttpResponse
from django.conf import settings
from PyPDF2 import PdfReader
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404

logger = logging.getLogger(__name__)

SUPPORTED_OLLAMA_MODELS = [
    {
        "name": "gemma4:e2b",
        "fallback_size": "6.7 GB",
        "description": "Google's Gemma E2B optimized variant.",
        "is_default": True,
    },
]

SUPPORTED_OLLAMA_MODEL_NAMES = [model["name"] for model in SUPPORTED_OLLAMA_MODELS]


def get_ollama_base_url():
    return os.environ.get(
        'OLLAMA_BASE_URL',
        getattr(settings, 'OLLAMA_BASE_URL', 'http://ollama:11434')
    ).rstrip('/')

# Import path patches to load ai-services modules
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_ROOT = os.path.dirname(BASE_DIR)
sys.path.append(os.path.join(WORKSPACE_ROOT, 'ai-services'))

from chunker import semantic_chunk_text
from ocr_service import extract_text_from_image
from ollama_client import (
    generate_completion,
    extract_metadata,
    generate_document_summary,
    generate_embeddings,
)
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


def extract_uploaded_file_text(uploaded_file, filename):
    ext = os.path.splitext(filename)[1].lower()

    if ext in ['.txt', '.md', '.markdown', '.py', '.js', '.ts', '.jsx', '.tsx', '.json', '.csv', '.html', '.css', '.rs', '.go', '.yaml', '.yml']:
        return uploaded_file.read().decode('utf-8', errors='ignore')

    suffix = ext or '.upload'
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            for chunk in uploaded_file.chunks():
                tmp.write(chunk)
            temp_path = tmp.name

        if ext == '.pdf':
            reader = PdfReader(temp_path)
            pages_text = []
            for page_index, page in enumerate(reader.pages, start=1):
                page_content = page.extract_text()
                if page_content:
                    pages_text.append(f"[Page {page_index}]\n\n{page_content}")
            extracted_text = "\n\n".join(pages_text)
            if extracted_text.strip():
                return extracted_text
            return "[Scanned PDF] No digital characters found. OCR or LLM vision extraction is required."

        if ext in ['.png', '.jpg', '.jpeg', '.webp']:
            return f"[Page 1]\n\n{extract_text_from_image(temp_path)}"

        return uploaded_file.read().decode('utf-8', errors='ignore')
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                logger.warning("Failed to delete temporary upload file: %s", temp_path)


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
            extracted_text = extract_uploaded_file_text(uploaded_file, filename).strip()
            if not extracted_text:
                return Response({"error": "No text could be extracted from the file"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

            chunks = semantic_chunk_text(extracted_text, chunk_size=1000, overlap=200)
            metadata = extract_metadata(extracted_text, fallback_title=filename)

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

        if not text:
            return Response({"error": "Document text is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            summary = generate_document_summary(text, fallback_title=filename)
            if not summary:
                return Response({"error": "AI summary could not be generated"}, status=status.HTTP_502_BAD_GATEWAY)
            return Response({"summary": summary}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Transient document summary generation failed for %s: %s", filename or "untitled", e)
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
    Retrieves semantic excerpts, constructs LLM prompt, queries local Ollama, and saves dialog logs.
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
        sources = []

        client_context = request.data.get('context_chunks') or []
        if client_context:
            for idx, item in enumerate(client_context[:24]):
                chunk_content = str(item.get('content') or item.get('text') or '').strip()
                if not chunk_content:
                    continue
                source_title = item.get('suggested_title') or item.get('filename') or 'Local document'
                context_chunks.append({
                    "title": source_title,
                    "chunk_index": item.get('chunk_index', idx),
                    "page_number": item.get('page_number'),
                    "section_title": item.get('section_title') or "Document",
                    "content_type": item.get('content_type') or "paragraph",
                    "reason": item.get('reason') or "retrieval",
                    "entities": item.get('entities') or {},
                    "content": chunk_content,
                })
                sources.append({
                    "document_id": str(item.get('document_id') or ''),
                    "filename": item.get('filename') or source_title,
                    "suggested_title": source_title,
                    "chunk_index": item.get('chunk_index', idx),
                    "page_number": item.get('page_number'),
                    "section_title": item.get('section_title') or "Document",
                    "snippet": chunk_content[:150] + ("..." if len(chunk_content) > 150 else ""),
                })

        # 3. Construct contextual prompt
        context_str = ""
        if context_chunks:
            if client_context:
                context_str = "\n".join([
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
            "When the answer depends on documents, cite source document names and sections/pages when available.\n"
            "If the context is empty or does not contain enough info, clearly state that the local documents do not contain enough information before using general knowledge.\n"
            "Keep your formatting clean, structured in markdown, and highly readable.\n\n"
            f"Retrieved Context:\n{context_str}"
        )

        # Extract active model
        active_model = request.data.get('model') or getattr(settings, 'OLLAMA_LLM_MODEL', 'gemma4:e2b')

        # 4. Generate LLM completion
        ai_response = generate_completion(content, system_prompt=system_prompt, stream=False, model=active_model)

        # 5. Save assistant response message with sourced documents list
        assistant_message = ChatMessage.objects.create(
            session=session,
            role='assistant',
            content=ai_response,
            sources=sources
        )

        # Update session timestamp to float to top of lists
        session.save()

        # Serialize and return
        serializer = ChatMessageSerializer(assistant_message)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class OllamaModelListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        ollama_url = get_ollama_base_url()

        # Fetch real installed models from Docker Ollama
        installed_models = {}
        ollama_available = False
        try:
            url = f"{ollama_url}/api/tags"
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                ollama_available = True
                models_data = response.json().get('models', [])
                for m in models_data:
                    name = m.get('name', '')
                    installed_models[name] = m
                    # Index without :latest suffix for convenience
                    if name.endswith(':latest'):
                        installed_models[name[:-7]] = m
        except Exception as e:
            logger.error(f"Failed to fetch tags from Docker Ollama ({ollama_url}): {e}")

        def format_size(byte_count):
            """Convert bytes to human-readable size string."""
            if byte_count <= 0:
                return "Unknown"
            gb = byte_count / (1024 ** 3)
            if gb >= 1.0:
                return f"{gb:.1f} GB"
            mb = byte_count / (1024 ** 2)
            return f"{mb:.0f} MB"

        models_list = []
        for model in SUPPORTED_OLLAMA_MODELS:
            name = model["name"]
            ollama_data = installed_models.get(name)
            is_installed = ollama_data is not None

            if is_installed:
                byte_count = ollama_data.get('size', 0)
                size_str = format_size(byte_count) if byte_count > 0 else model["fallback_size"]
            else:
                # Show fallback size estimate when not installed
                size_str = f"~{model['fallback_size']}"

            models_list.append({
                "name": name,
                "size": size_str,
                "description": model["description"],
                "installed": is_installed,
                "is_default": model["is_default"],
                "ollama_available": ollama_available,
            })

        return Response({"models": models_list, "ollama_available": ollama_available})




class OllamaModelPullView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        ollama_url = get_ollama_base_url()

        model_name = request.GET.get('model', 'gemma4:e2b')
        if model_name not in SUPPORTED_OLLAMA_MODEL_NAMES:
            return Response({"error": f"Unsupported model: {model_name}"}, status=status.HTTP_400_BAD_REQUEST)

        def event_stream():
            pull_url = f"{ollama_url}/api/pull"
            payload = {"model": model_name, "stream": True}
            try:
                # 20 minute timeout for large models
                response = requests.post(pull_url, json=payload, stream=True, timeout=1200)
                if response.status_code == 200:
                    for line in response.iter_lines():
                        if line:
                            yield f"data: {line.decode('utf-8')}\n\n"
                else:
                    yield f"data: {json.dumps({'error': f'Ollama returned status {response.status_code}: {response.text[:200]}'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        resp = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
        resp['Cache-Control'] = 'no-cache'
        resp['X-Accel-Buffering'] = 'no'
        return resp


class OllamaModelDeleteView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ollama_url = get_ollama_base_url()

        model_name = request.data.get('name')
        if not model_name:
            return Response({"error": "Model name is required"}, status=status.HTTP_400_BAD_REQUEST)

        if model_name not in SUPPORTED_OLLAMA_MODEL_NAMES:
            return Response({"error": f"Unsupported model: {model_name}"}, status=status.HTTP_400_BAD_REQUEST)

        delete_url = f"{ollama_url}/api/delete"
        payload = {"name": model_name}
        try:
            response = requests.delete(delete_url, json=payload, timeout=15)
            if response.status_code in [200, 204]:
                return Response({"success": True})
            else:
                return Response({"error": f"Ollama deletion failed ({response.status_code}): {response.text}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StatelessEmbeddingsView(APIView):
    """
    Stateless endpoint that generates embeddings for a batch of texts using Ollama.
    Persists absolutely no user files or vector results on the server.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        texts = request.data.get('texts')
        if not texts or not isinstance(texts, list):
            return Response({"error": "A list of 'texts' is required"}, status=status.HTTP_400_BAD_REQUEST)

        model_name = request.data.get('model', 'bge-m3')

        try:
            embeddings = generate_embeddings(texts, model=model_name)
            return Response({
                "embeddings": embeddings
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Stateless embeddings batch generation failed")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
