from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    StatelessDocumentProcessView,
    StatelessDocumentCategoryView,
    StatelessDocumentSummaryView,
    ChatSessionViewSet,
    ChatMessageCreateView,
    GroqModelListView,
    StatelessEmbeddingsView
)

router = DefaultRouter()
router.register(r'chat/session', ChatSessionViewSet, basename='chatsession')

urlpatterns = [
    path('documents/process/', StatelessDocumentProcessView.as_view(), name='document_process'),
    path('documents/summary/', StatelessDocumentSummaryView.as_view(), name='document_summary'),
    path('documents/category/', StatelessDocumentCategoryView.as_view(), name='document_category'),
    path('embeddings/', StatelessEmbeddingsView.as_view(), name='embeddings'),

    # DRF ViewSets
    path('', include(router.urls)),

    path('chat/session/<uuid:session_id>/message/', ChatMessageCreateView.as_view(), name='chat_message_create'),

    # Groq Model Configuration
    path('models/', GroqModelListView.as_view(), name='models_list'),
]
