from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    DocumentViewSet,
    SemanticSearchView,
    ChatSessionViewSet,
    ChatMessageCreateView,
    OllamaModelListView,
    OllamaModelPullView,
    OllamaModelDeleteView
)

router = DefaultRouter()
router.register(r'documents', DocumentViewSet, basename='document')
router.register(r'chat/session', ChatSessionViewSet, basename='chatsession')

urlpatterns = [
    # DRF ViewSets
    path('', include(router.urls)),

    # Custom API endpoints
    path('search/semantic/', SemanticSearchView.as_view(), name='semantic_search'),
    path('chat/session/<uuid:session_id>/message/', ChatMessageCreateView.as_view(), name='chat_message_create'),

    # Ollama Model Management
    path('models/', OllamaModelListView.as_view(), name='models_list'),
    path('models/pull/', OllamaModelPullView.as_view(), name='models_pull'),
    path('models/delete/', OllamaModelDeleteView.as_view(), name='models_delete'),
]
