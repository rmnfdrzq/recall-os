# Use Cases

This document describes product-level behavior that should remain stable as the implementation evolves. RecallOS is a local-only workspace: there are no accounts, login screens, authorization headers, or mock demo mode.

## UC-01: Open Local Workspace

Actor: local operator

Flow:

1. Operator starts the backend, worker, database, Redis, Ollama, and frontend.
2. Operator opens the Vite client.
3. Client loads documents, chat sessions, and available Ollama models from the local API.

Expected result:

- Workspace opens immediately.
- No registration, login, or demo-mode choice is shown.

## UC-02: Upload a Text or Markdown Document

Actor: local operator

Flow:

1. Operator drops or selects a `.txt`, `.md`, or `.markdown` file.
2. Client posts multipart form data to `/api/documents/`.
3. Backend creates a `Document` with `pending` status.
4. Celery worker reads file contents.
5. Worker chunks, embeds, and stores chunks.
6. Worker generates title, summary, category, and tags.
7. Document status changes to `processed`.

Expected result:

- Document appears in the library.
- Document detail includes chunks.
- Document participates in search and chat retrieval.

## UC-03: Upload a PDF

Actor: local operator

Flow:

1. Operator uploads a `.pdf` file.
2. Worker parses text with PyPDF2.
3. If digital text exists, it is indexed.
4. If no digital text exists, a scanned-PDF placeholder is indexed.

Expected result:

- Digital PDFs become searchable.
- Scanned PDFs do not crash ingestion.

Future extension:

- Rasterize scanned PDF pages and run OCR per page.

## UC-04: Upload an Image

Actor: local operator

Flow:

1. Operator uploads `.png`, `.jpg`, `.jpeg`, or `.webp`.
2. Worker sends file path to OCR service.
3. OCR text or fallback text is indexed.

Expected result:

- Screenshots with readable text can become searchable when EasyOCR is installed.
- Missing OCR dependencies do not break uploads.

## UC-05: Search Semantically

Actor: local operator

Flow:

1. Operator submits a natural language query.
2. Backend generates an embedding for the query.
3. Backend ranks local workspace chunks by cosine distance.
4. Client shows matching document titles, categories, snippets, and scores.

Expected result:

- Results can match meaning even without exact keyword overlap.

## UC-06: Chat With Knowledge Base

Actor: local operator

Flow:

1. Operator creates or selects a chat session.
2. Operator sends a question.
3. Backend saves the user message as a chat role, not an application user.
4. Backend retrieves relevant chunks.
5. Backend sends prompt and context to Ollama.
6. Backend saves assistant response with source references.
7. Client renders answer and source chips.

Expected result:

- Operator receives an answer grounded in stored documents when relevant context exists.

## UC-07: Select Local AI Model

Actor: local operator

Flow:

1. Operator opens Workspace Settings.
2. Operator opens AI Model Manager.
3. Client fetches `/api/models/`.
4. Installed models show `INSTALLED`.
5. Operator activates an installed model.
6. Chat requests include selected model in the JSON request body.

Expected result:

- Chat uses the selected local model.

## UC-08: Pull or Delete Model

Actor: local operator

Flow:

1. Operator opens AI Model Manager.
2. Operator starts download for a supported model.
3. Backend streams Ollama pull progress.
4. Client updates progress.
5. Operator can delete supported non-active models.

Expected result:

- UI model state matches Ollama model availability after refresh.

Constraints:

- Default active model cannot be deleted when it is the current model.
- Current active model cannot be deleted.
