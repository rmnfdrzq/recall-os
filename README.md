# RecallOS

RecallOS is a local-first AI knowledge workspace for uploading documents, extracting text, indexing content with embeddings, searching by semantic meaning, and chatting with a private document library through a local Ollama model.

The project is designed as a compact production-style portfolio system: React frontend, Django REST API, Celery background processing, PostgreSQL with pgvector, Redis, and local LLM/OCR services.

## Features

- Upload support for text, Markdown, PDF, and image files.
- Local-only workspace with no users, login, registration, or mock demo mode.
- Background document processing with Celery.
- Text extraction, OCR fallback, semantic chunking, and embedding generation.
- Vector search through PostgreSQL and pgvector.
- Contextual chat over indexed document chunks.
- Ollama model management from the UI.
- Light and dark theme support in the client.

## Technology Stack

### Frontend

- React 19
- Vite
- JavaScript
- CSS variables for theming
- lucide-react icons

### Backend

- Python
- Django
- Django REST Framework
- Celery
- Redis

### AI and Data

- Ollama for local LLM and embedding calls
- PostgreSQL
- pgvector
- PyPDF2
- EasyOCR, with a safe fallback when unavailable

### Infrastructure

- Docker Compose for PostgreSQL, Redis, and Ollama
- Local development servers for Django and Vite

## Repository Layout

```text
recallos/
├── ai-services/          # Ollama, OCR, and chunking helpers
├── backend/              # Django API, models, Celery tasks
├── client/               # React + Vite frontend
├── docs/                 # Long-term technical documentation
├── docker-compose.yml    # PostgreSQL, Redis, Ollama services
└── README.md             # Project overview and startup guide
```

## Prerequisites

- Python 3.11+ recommended
- Node.js 22+ recommended
- Docker and Docker Compose
- Ollama models available in the Docker Ollama volume or pulled through the UI/API

Supported UI catalog models:

- `qwen2.5:1.5b`
- `llama3.2:3b`
- `qwen3.5:4b`
- `qwen2.5:7b-instruct`
- `gemma4:e2b`

Embedding model default:

- `nomic-embed-text-v2-moe`

## Environment Variables

The backend reads environment variables from the process and from a root `.env` file when present.

Common local values:

```env
SECRET_KEY=django-insecure-recallos-development-secret-key-change-this
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

DB_NAME=recallos
DB_USER=recallos_user
DB_PASSWORD=recallos_secure_pass
DB_HOST=localhost
DB_PORT=5432

CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

OLLAMA_BASE_URL=http://127.0.0.1:11435
OLLAMA_LLM_MODEL=gemma4:e2b
OLLAMA_EMBED_MODEL=nomic-embed-text-v2-moe
OCR_ENGINE=easyocr
```

When running the Django backend inside the same Docker network as the Ollama container, use:

```env
OLLAMA_BASE_URL=http://ollama:11434
DB_HOST=db
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

## Quick Start

After dependencies are installed, the short launch commands are:

```bash
make install   # Python venv + backend packages + frontend packages
make docker    # Docker services: PostgreSQL, Redis, Ollama
make backend   # Django API + Celery worker
make frontend  # Vite client
make app       # Docker + backend + frontend in one terminal
```

`make app` runs `make install` first. `make backend` and `make app` run migrations before starting the API. Stop foreground processes with `Ctrl+C`.

Debug launches:

```bash
make docker-debug
make backend-debug
make frontend-debug
make app-debug
```

You can also use the variable form, for example `make frontend DEBUG=1` or `make app DEBUG=1`. The frontend debug mode shows technical panels such as `Debug: Indexed Text Portions`.

GNU Make's native flag also works, for example `make frontend --debug` or `make app --debug`, but it prints GNU Make diagnostic output in addition to enabling RecallOS debug behavior.

### 1. Start infrastructure

```bash
make docker
```

Ollama is exposed to the host on port `11435`.

### 2. Pull required Ollama models

```bash
curl http://127.0.0.1:11435/api/pull -d '{"model":"nomic-embed-text-v2-moe"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"qwen2.5:1.5b"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"llama3.2:3b"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"qwen3.5:4b"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"qwen2.5:7b-instruct"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"gemma4:e2b"}'
```

Models can also be pulled from the AI Model Manager in the UI.

### 3. Install backend dependencies

```bash
make install
```

### 4. Run database migrations

```bash
backend/.venv/bin/python backend/manage.py migrate
```

### 5. Start the Django API

```bash
make backend
```

### 6. Start the frontend

In a separate terminal:

```bash
cd client
cd ..
make frontend
```

Open:

```text
http://127.0.0.1:5173
```

## Common Development Commands

Backend:

```bash
python backend/manage.py test
python backend/manage.py makemigrations
python backend/manage.py migrate
```

Frontend:

```bash
cd client
npm run build
npm run lint
```

Infrastructure:

```bash
docker compose ps
docker compose logs -f ollama
docker compose down
```

## Documentation

Detailed project documentation is split by topic:

- [Architecture](docs/architecture.md)
- [Project Structure](docs/project-structure.md)
- [API Endpoints](docs/api-endpoints.md)
- [Data Model](docs/data-model.md)
- [AI Pipeline](docs/ai-pipeline.md)
- [Use Cases](docs/use-cases.md)
- [Development Guide](docs/development-guide.md)
- [Operations Guide](docs/operations.md)

## Current Limitations

- PDF OCR for scanned PDFs is represented as a fallback message unless page rasterization is added.
- OCR depends on EasyOCR availability; the service returns a safe placeholder when EasyOCR is not installed.
- The frontend is currently a single large React component and should be split as the UI grows.
- Production hardening still requires restricted CORS, secure secret management, deployment-specific settings, and persistent backup strategy.
