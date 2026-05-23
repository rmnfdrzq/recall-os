import re

from rest_framework import serializers
from .models import Document, DocumentChunk, ChatSession, ChatMessage


SUMMARY_PLACEHOLDERS = {
    "",
    "no summary generated",
    "no summary generated.",
    "no summary synthesized",
    "no summary synthesized.",
}


def is_missing_document_summary(summary):
    if summary is None:
        return True
    return str(summary).strip().lower() in SUMMARY_PLACEHOLDERS


def normalize_for_copy_check(value):
    return re.sub(r"[^a-z0-9а-яё]+", " ", value or "", flags=re.IGNORECASE).strip().lower()


def summary_copied_from_first_chunk(document):
    if is_missing_document_summary(document.summary):
        return False

    first_chunk = document.chunks.order_by("chunk_index").first()
    if not first_chunk:
        return False

    summary_norm = normalize_for_copy_check(document.summary)
    chunk_norm = normalize_for_copy_check(first_chunk.content)
    if len(summary_norm) < 60 or not chunk_norm:
        return False

    chunk_prefix = chunk_norm[:max(len(summary_norm) + 120, 300)]
    return chunk_prefix.startswith(summary_norm)


class DocumentSummaryMixin:
    def get_summary(self, document):
        if is_missing_document_summary(document.summary) or summary_copied_from_first_chunk(document):
            return ""
        return document.summary


class DocumentSerializer(DocumentSummaryMixin, serializers.ModelSerializer):
    summary = serializers.SerializerMethodField()

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


class DocumentDetailSerializer(DocumentSummaryMixin, serializers.ModelSerializer):
    summary = serializers.SerializerMethodField()
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
