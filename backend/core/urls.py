from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    StatelessDocumentProcessView,
    StatelessDocumentSummaryView,
    ChatSessionViewSet,
    ChatMessageCreateView,
    OllamaModelListView,
    OllamaModelPullView,
    OllamaModelDeleteView,
    StatelessEmbeddingsView
)

router = DefaultRouter()
router.register(r'chat/session', ChatSessionViewSet, basename='chatsession')

urlpatterns = [
    path('documents/process/', StatelessDocumentProcessView.as_view(), name='document_process'),
    path('documents/summary/', StatelessDocumentSummaryView.as_view(), name='document_summary'),
    path('embeddings/', StatelessEmbeddingsView.as_view(), name='embeddings'),

    # DRF ViewSets
    path('', include(router.urls)),

    path('chat/session/<uuid:session_id>/message/', ChatMessageCreateView.as_view(), name='chat_message_create'),

    # Ollama Model Management
    path('models/', OllamaModelListView.as_view(), name='models_list'),
    path('models/pull/', OllamaModelPullView.as_view(), name='models_pull'),
    path('models/delete/', OllamaModelDeleteView.as_view(), name='models_delete'),
]
