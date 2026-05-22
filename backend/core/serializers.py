from rest_framework import serializers
from .models import Document, DocumentChunk, ChatSession, ChatMessage


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = (
            'id', 'filename', 'file', 'file_type', 'status',
            'suggested_title', 'summary', 'category', 'tags',
            'created_at', 'updated_at'
        )
        read_only_fields = (
            'id', 'filename', 'file_type', 'status',
            'suggested_title', 'summary', 'category', 'tags',
            'created_at', 'updated_at'
        )


class DocumentChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentChunk
        fields = ('id', 'content', 'chunk_index')


class DocumentDetailSerializer(serializers.ModelSerializer):
    chunks = DocumentChunkSerializer(many=True, read_only=True)

    class Meta:
        model = Document
        fields = (
            'id', 'filename', 'file', 'file_type', 'status',
            'suggested_title', 'summary', 'category', 'tags',
            'created_at', 'updated_at', 'chunks'
        )
        read_only_fields = (
            'id', 'filename', 'file_type', 'status',
            'suggested_title', 'summary', 'category', 'tags',
            'created_at', 'updated_at', 'chunks'
        )


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = ('id', 'role', 'content', 'sources', 'created_at')
        read_only_fields = ('id', 'created_at')


class ChatSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatSession
        fields = ('id', 'title', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')


class ChatSessionDetailSerializer(serializers.ModelSerializer):
    messages = ChatMessageSerializer(many=True, read_only=True)

    class Meta:
        model = ChatSession
        fields = ('id', 'title', 'messages', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')
