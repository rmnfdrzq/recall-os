# ⚙️ Operations & Runtime Maintenance

This document details runtime requirements, host-to-container routing rules, fallback behaviors, and model override management for RecallOS.

---

## 💻 System Runtime Requirements

RecallOS operations rely on both host-native compilation layers and active network connectors:
*   **Active Port Allocations**:
    *   **Port `8000`**: Exposes the Django REST API (`recall-server` container).
    *   **Port `5432`**: Exposes the PostgreSQL 16 container.
    *   **Port `11434`**: Exposes the local Ollama daemon on the host.
*   **API Network Boundaries**: The Django backend makes outbound HTTP API requests to Groq (`api.groq.com`) and local host Ollama. Ensure firewall rules allow loopback communication and outbound HTTP request flows.

---

## 🔌 Host Networking (Docker to Host)

When running `recall-server` inside a Docker container, the container needs to make HTTP calls to the Ollama daemon running on the host machine.

### `host.docker.internal` Routing
To resolve this inside `docker-compose.yml`, the environment variable `OLLAMA_BASE_URL` is mapped to `host.docker.internal`:
```yaml
services:
  web:
    build: .
    environment:
      - OLLAMA_BASE_URL=http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"
```
*   **`extra_hosts` Configuration**: The directive `"host.docker.internal:host-gateway"` maps the special DNS name `host.docker.internal` to the host's loopback interface gateway, allowing the Django container to reach the host's Ollama daemon on port `11434`.

---

## 🔄 AI Inference Routing & Fallbacks

RecallOS utilizes robust fallback rules to ensure continuous operation, even when remote APIs or local networks degrade.

### 1. LLM Chat & Extraction Fallback (Groq ➡️ Ollama)
```text
Client request -> Call Groq API (Llama 4)
                      |
        +--[Success]--+--[Failure: rate limit/timeout/network]--+
        v                                                       v
Return Response                                    Retry local Ollama (Gemma 4)
                                                                |
                                                                v
                                                         Return Response
```
*   **Primary Path**: The server sends text and vision completions to the **Groq API** using `meta-llama/llama-4-scout-17b-16e-instruct` (configured as `GROQ_MODEL`).
*   **Secondary Path**: If Groq returns a rate limit, timeout, or credential error, `generate_completion` catches the error and retries the request instantly against local Ollama using `gemma4:31b-cloud` (configured as `OLLAMA_LLM_MODEL`).

### 2. Embeddings Fallback (Ollama BGE-M3 ➡️ Zero Vector)
*   **Primary Path**: The server routes embedding requests to local Ollama via the `/api/embed` batch endpoint (or single `/api/embeddings` calls).
*   **Secondary Path**: If the local Ollama daemon is offline or crashes, the endpoint returns a **1024-dimensional zero-vector array** (`[0.0, ...]`). This satisfies the client-side LanceDB schema constraints and lets the document ingestion pipeline finish without crashing the app.

---

## 📝 Environment Variable Overrides

Model assignments and host URLs are managed through environment variables in the server's `.env` configuration file:

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | *(Required)* | Secret key for cloud LLM chat and visual extraction. |
| `GROQ_MODEL` | `meta-llama/llama-4-scout-17b-16e-instruct` | Main model for prompt completion and vision tasks. |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama daemon network address. |
| `OLLAMA_EMBEDDING_MODEL`| `bge-m3` | Vector model for chunks representation. |
| `OLLAMA_LLM_MODEL` | `gemma4:31b-cloud` | Model for local fallback generation. |

---

## 📋 Pre-Flight Operations Checklist

Before launching the workspace for daily operations, verify that each layer is responsive:

*   [ ] **Local Ollama**: Run `ollama list` in the host terminal to ensure `bge-m3` and `gemma4:31b-cloud` are successfully pulled and available.
*   [ ] **Groq API Key**: Ensure your key is pasted in `recall-server/.env` and has not expired.
*   [ ] **Containers**: Run `docker ps` inside `recall-server/` to verify that both `web` and `db` are healthy and listening.
*   [ ] **Port 8000**: Query `curl -I http://127.0.0.1:8000/api/models/` to check that the Django API responds with a successful status.
*   [ ] **LanceDB Storage**: Check that the desktop user has write permissions for `<app_data_dir>/recallos_lancedb/` to allow successful indexing.
