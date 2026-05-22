# Development Guide

This guide describes how to work on RecallOS without losing the shape of the system.

## Local Setup

Start infrastructure:

```bash
make docker
```

Install all dependencies:

```bash
make install
```

Run migrations:

```bash
backend/.venv/bin/python backend/manage.py migrate
```

Run the full backend:

```bash
make backend
```

Run frontend:

```bash
make frontend
```

Run the full application in one terminal:

```bash
make app
```

`make app` runs `make install` before starting services.

## Development Workflow

1. Start Docker services.
2. Start Django API.
3. Start Celery worker.
4. Start Vite dev server.
5. Open the workspace directly in the browser.
6. Upload a small `.txt` or `.md` file first.
7. Confirm it reaches `processed`.
8. Test search and chat.

## Backend Guidelines

- Keep API request behavior in `backend/core/views.py`.
- Keep persistence changes in models and migrations.
- Keep background processing in `backend/core/tasks.py`.
- Keep reusable AI helpers in `ai-services/`.
- Keep the API local-only and avoid reintroducing user/session ownership without a dedicated product decision.
- Avoid calling slow AI/OCR work directly inside request handlers.

## Frontend Guidelines

- Put reusable visual tokens in `client/src/index.css`.
- Avoid hardcoded theme colors in JSX when a CSS variable can represent intent.
- Keep API URLs derived from `getBackendHost()`.
- Do not add new model names only on the frontend; update backend allowed models too.
- If `App.jsx` grows further, split by feature rather than by technical widget type.

## Adding a New Upload Type

1. Update extension detection in `DocumentViewSet.perform_create`.
2. Add extraction behavior in `process_document_pipeline`.
3. Add or update preview behavior in `App.jsx`.
4. Add tests for upload classification and processing behavior.
5. Document the new type in `README.md` and `docs/use-cases.md`.

## Adding a New Ollama Model

1. Add model metadata to `SUPPORTED_OLLAMA_MODELS` in `backend/core/views.py`.
2. Add the model name to the frontend fallback catalog in `client/src/App.jsx`.
3. Confirm pull/delete endpoints accept only intended model names.
4. Update `README.md`.
5. Update `docs/api-endpoints.md`.

## Adding a New API Endpoint

1. Add serializer if response shape is new.
2. Add view or viewset action.
3. Add URL in `backend/core/urls.py`.
4. Add test in `backend/core/tests.py`.
5. Update `docs/api-endpoints.md`.

## Testing

Backend:

```bash
python backend/manage.py test
```

Frontend build:

```bash
cd client
npm run build
```

Frontend lint:

```bash
cd client
npm run lint
```

Known note: current lint status may include pre-existing React unused import and hook dependency issues. Treat lint failures as actionable before merging production work.

## Debugging Checklist

If documents stay `pending`:

- Is Redis running?
- Is Celery worker running?
- Does worker import `ai-services` correctly?
- Does the uploaded file exist under `backend/media/documents/`?

If documents become `failed`:

- Check Celery logs.
- Check Ollama connection.
- Check embedding model availability.
- Check vector dimensions.

If search returns no results:

- Confirm document status is `processed`.
- Confirm chunks were created.
- Confirm embeddings are not null.
- Confirm query embedding generation works.

If chat returns Ollama errors:

- Confirm selected model exists in Ollama.
- Check `OLLAMA_BASE_URL`.
- Check `/api/tags` on the Ollama service.
