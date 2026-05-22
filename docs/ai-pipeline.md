# AI Pipeline

The AI pipeline is centered on local Ollama models and runs primarily in the Celery task `process_document_pipeline`.

## Files

```text
backend/core/tasks.py
ai-services/ollama_client.py
ai-services/chunker.py
ai-services/ocr_service.py
```

## Upload Processing Pipeline

```text
Document uploaded
  -> Document.status = pending
  -> Celery task starts
  -> Document.status = processing
  -> text extraction
  -> semantic chunking
  -> embedding generation
  -> DocumentChunk bulk insert
  -> metadata extraction
  -> Document.status = processed
```

If the task fails, it sets:

```text
Document.status = failed
Document.summary = "Pipeline failed: ..."
```

## Text Extraction

Extraction is based on extension:

| Extension | Behavior |
| --- | --- |
| `.txt`, `.md`, `.markdown` | Read as UTF-8 text with ignored errors |
| `.pdf` | Parse pages through PyPDF2 |
| `.png`, `.jpg`, `.jpeg`, `.webp` | Send to OCR service |
| Other | Try plain text read fallback |

Scanned PDFs currently receive a placeholder when PyPDF2 finds no digital text. Future scanned PDF support should rasterize pages and pass images through OCR.

## OCR

`ocr_service.py` tries to use EasyOCR. If EasyOCR is missing or initialization fails, the service returns a stable fallback string rather than crashing the pipeline.

This design keeps ingestion robust while making OCR quality an optional environment capability.

## Chunking

`semantic_chunk_text(text, chunk_size=500, overlap=100)`:

- normalizes excessive newlines
- splits text on sentence boundaries
- groups sentences into chunks
- keeps overlap from previous chunk
- splits very long sentences by word length

Chunk size is character-based, not token-based.

## Embeddings

`generate_embedding(text)` calls Ollama using:

1. `/api/embed` with `input`
2. fallback `/api/embeddings` with `prompt`

Default embedding model:

```text
nomic-embed-text
```

The database expects 768-dimensional vectors.

## Metadata Extraction

`extract_metadata(document_text, fallback_title)` asks the local LLM for JSON:

```json
{
  "suggested_title": "Short clear title",
  "summary": "Concise 3-line summary",
  "category": "Engineering",
  "tags": ["tag1", "tag2", "tag3"]
}
```

The code strips Markdown fences and attempts JSON parsing. If parsing fails, it uses regex fallbacks and safe defaults.

## Completion and Fallback Models

`generate_completion()` calls Ollama `/api/generate`.

If the selected model is missing, `get_fallback_model()` asks `/api/tags` and chooses:

1. model with matching base name
2. first model starting with `qwen`
3. first installed model

## Search Pipeline

```text
Query text
  -> generate query embedding
  -> filter chunks to local workspace documents
  -> annotate with CosineDistance
  -> order by distance
  -> return top_k chunks
```

Similarity is calculated as:

```text
similarity = 1 - cosine_distance
```

## Chat RAG Pipeline

```text
User message
  -> save user ChatMessage
  -> generate query embedding
  -> retrieve top 4 relevant chunks
  -> apply similarity threshold > 0.3
  -> build system prompt with retrieved excerpts
  -> call Ollama completion
  -> save assistant ChatMessage with sources
```

The assistant is instructed to use retrieved personal excerpts when available and to clearly state when context is insufficient.

## Operational Requirements

For the pipeline to work end to end:

- Redis must be reachable by Django and Celery.
- Celery worker must be running.
- PostgreSQL must have pgvector support.
- Ollama must have the embedding model installed.
- At least one supported LLM should be installed.
