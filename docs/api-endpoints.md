# 🌐 HTTP API Endpoints Contract

RecallOS Server operates on a REST-based API model. All communications use JSON payloads (except multipart file uploads) and return standard HTTP statuses. In development mode, endpoints do not enforce authorization boundaries.

---

## 🗄️ Endpoint Summary

| Method | Route | Description |
| :--- | :--- | :--- |
| **POST** | `/api/documents/process/` | Transient fallback file extraction (OCR/Vision/PDF). |
| **POST** | `/api/documents/summary/` | Transient document summary generation. |
| **POST** | `/api/documents/category/` | Transient document category classification. |
| **POST** | `/api/embeddings/` | Stateless BGE-M3 text embedding generation. |
| **GET** | `/api/chat/session/` | List all chat sessions. |
| **POST** | `/api/chat/session/` | Create a new chat session. |
| **GET** | `/api/chat/session/{id}/` | Retrieve chat session details & message log. |
| **POST** | `/api/chat/session/{id}/message/` | Post a user message and receive the AI RAG answer. |
| **GET** | `/api/models/` | List configured AI model identifiers. |

---

## 📄 Ingestion & AI Utility APIs

### 1. Transient Document Processor
Used by the client as a fallback parsing engine when local file parsing fails (e.g. image files or complex scanned PDFs).

*   **Route**: `POST /api/documents/process/`
*   **Request Format**: `multipart/form-data`
    *   `file`: Binary file stream
*   **Response JSON (Success - 200 OK)**:
    ```json
    {
      "filename": "scanned_receipt.png",
      "file_type": "png",
      "text": "Extracted text content from visual LLM analysis...",
      "chunks": [
        "Extracted text content from visual LLM analysis..."
      ],
      "suggested_title": "Scanned Receipt",
      "summary": "AI summary of the scanned document.",
      "category": "Finance",
      "tags": ["AI-Ingested"]
    }
    ```

### 2. Transient Summary Generator
Accepts plain text and generates a concise summary.

*   **Route**: `POST /api/documents/summary/`
*   **Request JSON**:
    ```json
    {
      "filename": "source_code.py",
      "text": "import os\n\ndef main():\n    print('Hello World')",
      "model_profile": "text"
    }
    ```
*   **Response JSON (200 OK)**:
    ```json
    {
      "summary": "A basic Python script executing a Hello World print statement."
    }
    ```

### 3. Transient Category Classifier
Categorizes a document based on its text chunks and summary.

*   **Route**: `POST /api/documents/category/`
*   **Request JSON**:
    ```json
    {
      "filename": "source_code.py",
      "summary": "A basic Python script executing a Hello World print statement.",
      "chunks": [
        { "content": "import os\n\ndef main():\n    print('Hello World')" }
      ],
      "model_profile": "text"
    }
    ```
*   **Response JSON (200 OK)**:
    ```json
    {
      "category": "Development"
    }
    ```

### 4. Stateless Embeddings Generator
Generates dense vector embeddings (1024 dimensions) for input text strings using local Ollama.

*   **Route**: `POST /api/embeddings/`
*   **Request JSON**:
    ```json
    {
      "texts": [
        "First text segment to embed",
        "Second text segment to embed"
      ],
      "model": "ignored"
    }
    ```
*   **Response JSON (200 OK)**:
    ```json
    {
      "embeddings": [
        [0.0123, -0.0543, 0.9876, "... 1021 values ..."],
        [-0.0876, 0.0432, -0.1234, "... 1021 values ..."]
      ]
    }
    ```

---

## 💬 Conversational Chat APIs

### 1. List Sessions
*   **Route**: `GET /api/chat/session/`
*   **Response JSON (200 OK)**:
    ```json
    [
      {
        "id": "a9a81234-abcd-ef01-2345-6789abcdef01",
        "title": "Local LanceDB Discussion",
        "created_at": "2026-05-26T15:40:00Z",
        "updated_at": "2026-05-26T15:42:00Z"
      }
    ]
    ```

### 2. Create Session
*   **Route**: `POST /api/chat/session/`
*   **Request JSON**:
    ```json
    {
      "title": "Tauri Rust Integration"
    }
    ```
*   **Response JSON (201 Created)**:
    ```json
    {
      "id": "f5f5f5f5-eeee-dddd-cccc-bbbbbbbbbbbb",
      "title": "Tauri Rust Integration",
      "created_at": "2026-05-26T15:45:00Z",
      "updated_at": "2026-05-26T15:45:00Z"
```

### 3. Retrieve Session Detail
*   **Route**: `GET /api/chat/session/{id}/`
*   **Response JSON (200 OK)**:
    ```json
    {
      "id": "f5f5f5f5-eeee-dddd-cccc-bbbbbbbbbbbb",
      "title": "Tauri Rust Integration",
      "created_at": "2026-05-26T15:45:00Z",
      "updated_at": "2026-05-26T15:45:00Z",
      "messages": [
        {
          "id": 1,
          "role": "user",
          "content": "What is the vector dimension?",
          "sources": [],
          "created_at": "2026-05-26T15:45:10Z"
        },
        {
          "id": 2,
          "role": "assistant",
          "content": "According to the LanceDB configurations, vectors are expected to be 1024-dimensional.",
          "sources": [
            {
              "document_id": "doc-uuid-9999",
              "filename": "recallos_spec.pdf",
              "suggested_title": "RecallOS Specification",
              "chunk_index": 12,
              "page_number": 3,
              "section_title": "Embeddings Layer",
              "snippet": "Vectors are expected to be 1024-dimensional for BGE-M3."
            }
          ],
          "created_at": "2026-05-26T15:45:15Z"
        }
      ]
    }
    ```

### 4. Post Message (AI RAG Inference)
Sends a user message alongside client-side retrieved RAG chunks to perform contextual answer generation.

*   **Route**: `POST /api/chat/session/{id}/message/`
*   **Request JSON**:
    ```json
    {
      "content": "What is the vector dimension?",
      "context_chunks": [
        {
          "document_id": "doc-uuid-9999",
          "filename": "recallos_spec.pdf",
          "suggested_title": "RecallOS Specification",
          "chunk_index": 12,
          "page_number": 3,
          "section_title": "Embeddings Layer",
          "content_type": "paragraph",
          "reason": "semantic_rerank",
          "entities": {},
          "content": "Vectors are expected to be 1024-dimensional for BGE-M3. The local LanceDB layer pads or truncates vectors."
        }
      ]
    }
    ```
*   **Response JSON (200 OK)**:
    ```json
    {
      "id": 2,
      "role": "assistant",
      "content": "According to the LanceDB configurations, vectors are expected to be 1024-dimensional.",
      "sources": [
        {
          "document_id": "doc-uuid-9999",
          "filename": "recallos_spec.pdf",
          "suggested_title": "RecallOS Specification",
          "chunk_index": 12,
          "page_number": 3,
          "section_title": "Embeddings Layer",
          "snippet": "Vectors are expected to be 1024-dimensional for BGE-M3. The local LanceDB layer pads or truncates vectors."
        }
      ],
      "created_at": "2026-05-26T15:45:15Z"
    }
    ```

---

## 🤖 System Information APIs

### 1. Get Configured Models
Lists active model configurations.

*   **Route**: `GET /api/models/`
*   **Response JSON (200 OK)**:
    ```json
    {
      "primary_llm_model": "meta-llama/llama-4-scout-17b-16e-instruct",
      "fallback_llm_model": "gemma4:31b-cloud",
      "embedding_model": "bge-m3"
    }
    ```
