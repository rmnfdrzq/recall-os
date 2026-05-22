import os
import tempfile
from unittest.mock import patch
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from core.models import Document, DocumentChunk, ChatSession, ChatMessage

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
