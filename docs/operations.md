# Operations Guide

This document covers day-to-day runtime checks and operational maintenance.

## Services

Docker Compose starts:

| Service | Container | Host Port | Purpose |
| --- | --- | --- | --- |
| PostgreSQL | `recallos_db` | `5432` | Application data and vectors |
| Redis | `recallos_redis` | `6379` | Celery broker and result backend |
| Ollama | `recallos_ollama` | `11435` | Local model runtime |

The Django API and Vite client are normally run on the host during local development.

## Health Checks

Check containers:

```bash
docker compose ps
```

Check Ollama tags:

```bash
curl http://127.0.0.1:11435/api/tags
```

Check Django:

```bash
curl http://127.0.0.1:8000/api/models/
```

The Django API is local-only and does not require authentication headers.

## Model Management

Pull models:

```bash
curl http://127.0.0.1:11435/api/pull -d '{"model":"nomic-embed-text-v2-moe"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"qwen2.5:1.5b"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"llama3.2:3b"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"qwen3.5:4b"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"qwen2.5:7b-instruct"}'
curl http://127.0.0.1:11435/api/pull -d '{"model":"gemma4:e2b"}'
```

List models:

```bash
curl http://127.0.0.1:11435/api/tags
```

Delete a model:

```bash
curl -X DELETE http://127.0.0.1:11435/api/delete -d '{"name":"qwen3.5:4b"}'
```

## Logs

Docker logs:

```bash
docker compose logs -f db
docker compose logs -f redis
docker compose logs -f ollama
```

Celery logs are printed by the worker process:

```bash
cd backend
celery -A recallos worker -l info
```

Django logs are printed by `runserver`.

## Backups

PostgreSQL data lives in the Docker volume `pgdata`. Ollama models live in the Docker volume `ollama`.

For development backup:

```bash
docker exec recallos_db pg_dump -U recallos_user recallos > recallos-backup.sql
```

Restore:

```bash
cat recallos-backup.sql | docker exec -i recallos_db psql -U recallos_user recallos
```

For production, use scheduled backups and tested restore procedures.

## Common Failures

### Ollama unavailable

Symptoms:

- model list shows unavailable
- embeddings fail
- chat returns connection error

Checks:

```bash
docker compose ps ollama
curl http://127.0.0.1:11435/api/tags
```

If Django runs inside Docker, set:

```env
OLLAMA_BASE_URL=http://ollama:11434
```

If Django runs on the host, set:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11435
```

### Celery not processing documents

Symptoms:

- documents remain `pending`
- chunks are never created

Checks:

```bash
docker compose ps redis
cd backend
celery -A recallos worker -l info
```

### pgvector mismatch

Symptoms:

- vector insert errors
- search errors involving dimensions

Cause:

- `DocumentChunk.embedding` expects 768 dimensions.
- Current default embedding model is `nomic-embed-text-v2-moe`.

Resolution:

- Use a 768-dimensional embedding model or create a migration and reindex all chunks.

## Production Hardening Checklist

- Set `DEBUG=False`.
- Replace development `SECRET_KEY`.
- Restrict `ALLOWED_HOSTS`.
- Restrict CORS origins.
- Store secrets outside source control.
- Run Django through a production ASGI/WSGI server.
- Serve static and media files through appropriate storage.
- Add database backups.
- Add health checks and monitoring.
- Add rate limiting for AI endpoints if the service is exposed beyond localhost.
- Add upload size limits.
- Add malware scanning or content validation for uploaded files if exposed publicly.
