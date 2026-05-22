import os
import sys
import logging
import json
import requests
from django.http import StreamingHttpResponse
from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404
from pgvector.django import CosineDistance

logger = logging.getLogger(__name__)

SUPPORTED_OLLAMA_MODELS = [
    {
        "name": "qwen2.5:1.5b",
        "fallback_size": "986 MB",
        "description": "Default lightweight LLM — fast & memory-efficient.",
        "is_default": True,
    },
    {
        "name": "qwen3.5:4b",
        "fallback_size": "2.6 GB",
        "description": "Balanced medium-sized model for complex reasoning.",
        "is_default": False,
    },
    {
        "name": "gemma4:e2b",
        "fallback_size": "1.6 GB",
        "description": "Google's Gemma E2B optimized variant.",
        "is_default": False,
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

from ollama_client import generate_embedding, generate_completion, OLLAMA_BASE_URL
from .models import Document, DocumentChunk, ChatSession, ChatMessage
from .serializers import (
    DocumentSerializer,
    DocumentDetailSerializer,
    ChatSessionSerializer,
    ChatSessionDetailSerializer,
    ChatMessageSerializer
)
from .tasks import process_document_pipeline


class DocumentViewSet(viewsets.ModelViewSet):
    """
    Handles Document uploading, listing, details and deleting.
    Triggers Celery background tasks upon upload.
    """
    serializer_class = DocumentSerializer
    permission_classes = [AllowAny]

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return DocumentDetailSerializer
        return self.serializer_class

    def get_queryset(self):
        return Document.objects.all()

    def perform_create(self, serializer):
        uploaded_file = self.request.FILES.get('file')
        filename = uploaded_file.name

        # Simple extension matching
        ext = os.path.splitext(filename)[1].lower()
        file_type = 'text'
        if ext in ['.png', '.jpg', '.jpeg', '.webp']:
            file_type = 'image'
        elif ext == '.pdf':
            file_type = 'pdf'
        elif ext in ['.md', '.markdown']:
            file_type = 'markdown'

        document = serializer.save(
            filename=filename,
            file_type=file_type,
            status='pending'
        )

        # Fire async background processing task
        process_document_pipeline.delay(document.id)
        logger.info(f"Queued background processing for uploaded document: {filename} (ID: {document.id})")


class SemanticSearchView(APIView):
    """
    Executes Semantic Search using local embedding model and pgvector similarity match.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        query = request.data.get('query', '').strip()
        category = request.data.get('category', '').strip()
        top_k = int(request.data.get('top_k', 5))

        if not query:
            return Response({"error": "Query parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Generate query vector using local model
        query_vector = generate_embedding(query)
        if not query_vector:
            return Response(
                {"error": "Failed to generate query embeddings. Please check Ollama connection status."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        # Query chunks with CosineDistance similarity metric across the local workspace.
        queryset = DocumentChunk.objects.all()

        # Apply metadata categorization filters
        if category:
            queryset = queryset.filter(document__category__iexact=category)

        # Fetch matching chunks order by vector distance
        chunks = queryset.annotate(
            distance=CosineDistance('embedding', query_vector)
        ).order_by('distance')[:top_k]

        results = []
        for chunk in chunks:
            # Skip unindexed/failed embeddings
            if chunk.distance is None:
                continue

            similarity = round(1 - chunk.distance, 4) # cosine similarity = 1 - cosine distance
            results.append({
                "document_id": chunk.document.id,
                "filename": chunk.document.filename,
                "suggested_title": chunk.document.suggested_title,
                "category": chunk.document.category,
                "content": chunk.content,
                "chunk_index": chunk.chunk_index,
                "similarity": similarity
            })

        return Response({
            "query": query,
            "results": results
        })


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
        query_vector = generate_embedding(content)
        context_chunks = []
        sources = []

        if query_vector:
            # Query top 4 most similar chunks from processed local documents.
            chunks = DocumentChunk.objects.filter(
                document__status='processed'
            ).annotate(
                distance=CosineDistance('embedding', query_vector)
            ).order_by('distance')[:4]

            for chunk in chunks:
                if chunk.distance is not None and (1 - chunk.distance) > 0.3: # similarity threshold
                    context_chunks.append(chunk)
                    sources.append({
                        "document_id": str(chunk.document.id),
                        "filename": chunk.document.filename,
                        "suggested_title": chunk.document.suggested_title or chunk.document.filename,
                        "chunk_index": chunk.chunk_index,
                        "snippet": chunk.content[:150] + "..."
                    })

        # 3. Construct contextual prompt
        context_str = ""
        if context_chunks:
            context_str = "\n".join([
                f"Source Document: {c.document.suggested_title or c.document.filename} (Chunk {c.chunk_index})\n"
                f"Content Excerpt:\n{c.content}\n"
                f"---"
                for c in context_chunks
            ])

        system_prompt = (
            "You are RecallOS AI, a personal knowledge workspace assistant.\n"
            "You answer the user's questions utilizing ONLY the retrieved personal document excerpts supplied below.\n"
            "If the context is empty or does not contain enough info, clearly state it and answer based on general knowledge.\n"
            "Keep your formatting clean, structured in markdown, and highly readable.\n\n"
            f"Retrieved Context:\n{context_str}"
        )

        # Extract active model
        active_model = request.data.get('model') or request.headers.get('X-Active-Model') or 'qwen2.5:1.5b'

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

        model_name = request.GET.get('model', 'qwen2.5:1.5b')
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
