import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from core.models import Document, DocumentChunk, ChatSession, ChatMessage

AI_SERVICES_DIR = Path(__file__).resolve().parents[2] / "ai-services"
if str(AI_SERVICES_DIR) not in sys.path:
    sys.path.append(str(AI_SERVICES_DIR))

from ollama_client import extract_metadata

# Mock embeddings for pgvector dimension 768
MOCK_EMBEDDING = [0.05] * 768

class RecallOSTests(APITestCase):

    def setUp(self):
        self.client.credentials()

    @patch('core.views.generate_embedding')
    @patch('core.views.process_document_pipeline.delay')
    def test_document_upload(self, mock_pipeline, mock_embed):
        # Upload document
        upload_url = reverse('document-list')
        file_content = b"This is a premium knowledge document about quantum computation."
        uploaded_file = SimpleUploadedFile("quantum.txt", file_content, content_type="text/plain")

        data = {
            "file": uploaded_file
        }
        response = self.client.post(upload_url, data, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['filename'], "quantum.txt")
        self.assertEqual(response.data['file_type'], "text")
        self.assertEqual(response.data['status'], "pending")

        # Ensure the Celery pipeline was triggered
        self.assertTrue(mock_pipeline.called)

    @patch('core.views.generate_embedding')
    def test_semantic_search_empty(self, mock_embed):
        mock_embed.return_value = MOCK_EMBEDDING

        # Search documents
        search_url = reverse('semantic_search')
        data = {
            "query": "quantum computation",
            "top_k": 3
        }
        response = self.client.post(search_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['query'], "quantum computation")
        self.assertEqual(len(response.data['results']), 0) # No indexed documents yet

    @patch('core.views.generate_embedding')
    def test_semantic_search_with_results(self, mock_embed):
        mock_embed.return_value = MOCK_EMBEDDING

        # Create a document and a pre-embedded chunk
        document = Document.objects.create(
            filename="quantum.txt",
            file_type="text",
            status="processed",
            suggested_title="Quantum Physics Overview",
            category="Physics",
            tags=["quantum", "physics"]
        )

        chunk = DocumentChunk.objects.create(
            document=document,
            content="Quantum computing relies on superposition and entanglement.",
            chunk_index=0,
            embedding=MOCK_EMBEDDING
        )

        search_url = reverse('semantic_search')
        data = {
            "query": "quantum superposition",
            "top_k": 2
        }
        response = self.client.post(search_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['content'], chunk.content)
        self.assertEqual(response.data['results'][0]['similarity'], 1.0) # CosineDistance of same vector is 0, so similarity is 1.0

    def test_document_detail_does_not_replace_missing_ai_summary_with_chunks(self):
        document = Document.objects.create(
            filename="strategy.txt",
            file_type="text",
            status="processed",
            suggested_title="Strategy Notes",
            summary="No summary generated.",
            category="General",
            tags=["AI-Ingested"]
        )
        DocumentChunk.objects.create(
            document=document,
            content="This document explains the product strategy for local-first document search. It covers upload processing, semantic indexing, and contextual chat over stored knowledge.",
            chunk_index=0
        )

        response = self.client.get(reverse('document-detail', kwargs={"pk": document.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['summary'], "")

    def test_document_detail_hides_summary_copied_from_first_chunk(self):
        copied_summary = "This document explains the product strategy for local-first document search."
        document = Document.objects.create(
            filename="strategy.txt",
            file_type="text",
            status="processed",
            suggested_title="Strategy Notes",
            summary=copied_summary,
            category="General",
            tags=["AI-Ingested"]
        )
        DocumentChunk.objects.create(
            document=document,
            content=f"{copied_summary} It covers upload processing, semantic indexing, and contextual chat over stored knowledge.",
            chunk_index=0
        )

        response = self.client.get(reverse('document-detail', kwargs={"pk": document.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['summary'], "")

    @patch('core.views.generate_document_summary')
    def test_document_summarize_endpoint_generates_and_saves_summary(self, mock_summary):
        mock_summary.return_value = "This document is a concise AI summary about a local-first search workspace."
        document = Document.objects.create(
            filename="strategy.txt",
            file_type="text",
            status="processed",
            suggested_title="Strategy Notes",
            summary="",
            category="General",
            tags=["AI-Ingested"]
        )
        DocumentChunk.objects.create(
            document=document,
            content="Raw first chunk that should be sent as source material, not displayed as a fallback summary.",
            chunk_index=0
        )

        response = self.client.post(reverse('document-summarize', kwargs={"pk": document.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['summary'], mock_summary.return_value)
        self.assertEqual(len(response.data['chunks']), 1)
        document.refresh_from_db()
        self.assertEqual(document.summary, mock_summary.return_value)
        mock_summary.assert_called_once()

    @patch('ollama_client.generate_completion')
    def test_extract_metadata_generates_llm_summary_when_json_summary_missing(self, mock_completion):
        document_text = (
            "This is the first indexed text portion and should not be reused as the summary. "
            "It contains implementation details, line items, and raw document phrasing. "
            "Later sections describe a local-first AI workspace for document search and chat."
        )
        ai_summary = "The document describes a local-first AI workspace that indexes uploaded files and supports semantic search with contextual chat."
        mock_completion.side_effect = [
            '{"suggested_title": "Workspace Notes", "category": "Technology", "tags": ["AI", "search"]}',
            ai_summary,
        ]

        metadata = extract_metadata(document_text, fallback_title="workspace.txt")

        self.assertEqual(metadata['summary'], ai_summary)
        self.assertNotEqual(metadata['summary'], document_text[:len(metadata['summary'])])
        self.assertEqual(mock_completion.call_count, 2)

    @patch('ollama_client.generate_completion')
    def test_extract_metadata_regenerates_summary_when_json_summary_copies_source(self, mock_completion):
        copied_summary = "This is the first indexed text portion and should not be reused as the summary."
        document_text = (
            f"{copied_summary} It contains implementation details and raw document phrasing. "
            "Later sections describe a local-first AI workspace for document search and chat."
        )
        ai_summary = "The document describes a local-first AI workspace for indexing documents and chatting with retrieved context."
        mock_completion.side_effect = [
            f'{{"suggested_title": "Workspace Notes", "summary": "{copied_summary}", "category": "Technology", "tags": ["AI"]}}',
            ai_summary,
        ]

        metadata = extract_metadata(document_text, fallback_title="workspace.txt")

        self.assertEqual(metadata['summary'], ai_summary)
        self.assertEqual(mock_completion.call_count, 2)

    @patch('core.views.generate_embedding')
    @patch('core.views.generate_completion')
    def test_chat_session_and_message(self, mock_completion, mock_embed):
        mock_embed.return_value = MOCK_EMBEDDING
        mock_completion.return_value = "Superposition enables parallel state evaluation."

        # Create Chat Session
        session_response = self.client.post(reverse('chatsession-list'), {
            "title": "Quantum AI Dialogue"
        }, format='json')
        self.assertEqual(session_response.status_code, status.HTTP_201_CREATED)
        session_id = session_response.data['id']

        # Append Message (triggers RAG Rationale)
        message_url = reverse('chat_message_create', kwargs={"session_id": session_id})
        message_response = self.client.post(message_url, {
            "content": "Explain superposition"
        }, format='json')

        self.assertEqual(message_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(message_response.data['role'], 'assistant')
        self.assertEqual(message_response.data['content'], "Superposition enables parallel state evaluation.")

        # Fetch session details with messages list
        detail_url = reverse('chatsession-detail', kwargs={"pk": session_id})
        detail_response = self.client.get(detail_url)
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(detail_response.data['messages']), 2) # User message and AI message
        self.assertEqual(detail_response.data['messages'][0]['role'], 'user')
        self.assertEqual(detail_response.data['messages'][1]['role'], 'assistant')

    @patch('core.views.requests.get')
    def test_model_list_marks_supported_installed_ollama_models(self, mock_get):
        mock_get.return_value.status_code = status.HTTP_200_OK
        mock_get.return_value.json.return_value = {
            "models": [
                {"name": "qwen2.5:1.5b", "size": 986 * 1024 * 1024},
                {"name": "qwen3.5:4b", "size": int(2.6 * 1024 * 1024 * 1024)},
                {"name": "gemma4:e2b", "size": int(1.6 * 1024 * 1024 * 1024)},
            ]
        }

        response = self.client.get(reverse('models_list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        models = response.data['models']
        names = [model['name'] for model in models]
        self.assertEqual(names, ['qwen2.5:1.5b', 'qwen3.5:4b', 'gemma4:e2b'])
        self.assertNotIn('qwen2.5:7b-instruct', names)
        self.assertTrue(all(model['installed'] for model in models))
