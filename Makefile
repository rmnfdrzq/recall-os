SHELL := /bin/bash

VENV ?= backend/.venv
SYSTEM_PYTHON ?= python3
PYTHON ?= $(shell if [ -x backend/.venv/bin/python ]; then printf 'backend/.venv/bin/python'; elif [ -x .venv/bin/python ]; then printf '.venv/bin/python'; else printf 'backend/.venv/bin/python'; fi)
CELERY ?= $(shell if [ -x backend/.venv/bin/celery ]; then printf 'backend/.venv/bin/celery'; elif [ -x .venv/bin/celery ]; then printf '.venv/bin/celery'; else printf 'backend/.venv/bin/celery'; fi)
NPM ?= npm

.PHONY: install docker migrate backend frontend app

install:
	@if [ ! -x "$(VENV)/bin/python" ]; then $(SYSTEM_PYTHON) -m venv "$(VENV)"; fi
	$(VENV)/bin/python -m pip install --upgrade pip
	$(VENV)/bin/pip install -r backend/requirements.txt
	cd client && $(NPM) install

docker:
	docker compose up -d db redis ollama

migrate:
	@if [ ! -x "$(PYTHON)" ]; then echo "Missing $(PYTHON). Create backend/.venv and install backend/requirements.txt."; exit 1; fi
	@set -e; \
	for attempt in {1..30}; do \
		output=$$($(PYTHON) backend/manage.py migrate 2>&1) && { echo "$$output"; break; } || rc=$$?; \
		echo "$$output"; \
		if ! echo "$$output" | grep -Eiq 'connection .*refused|could not connect|database system is starting up|Connection refused|Operation not permitted'; then exit $$rc; fi; \
		if [ $$attempt -eq 30 ]; then echo "PostgreSQL is not ready."; exit 1; fi; \
		echo "Waiting for PostgreSQL ($$attempt/30)..."; \
		sleep 2; \
	done

.backend-run:
	@if [ ! -x "$(PYTHON)" ]; then echo "Missing $(PYTHON). Create backend/.venv and install backend/requirements.txt."; exit 1; fi
	@if [ ! -x "$(CELERY)" ]; then echo "Missing $(CELERY). Install backend dependencies."; exit 1; fi
	@set -e; \
	$(PYTHON) backend/manage.py runserver 127.0.0.1:8000 & api=$$!; \
	cd backend && ../$(CELERY) -A recallos worker -l info & worker=$$!; \
	trap 'kill $$api $$worker 2>/dev/null || true' INT TERM EXIT; \
	wait $$api $$worker

backend: migrate .backend-run

frontend:
	cd client && $(NPM) run dev -- --host 127.0.0.1

app: install
	@if [ ! -x "$(PYTHON)" ]; then echo "Missing $(PYTHON). Create backend/.venv and install backend/requirements.txt."; exit 1; fi
	@if [ ! -x "$(CELERY)" ]; then echo "Missing $(CELERY). Install backend dependencies."; exit 1; fi
	@docker compose up -d db redis ollama
	@$(MAKE) migrate
	@set -e; \
	$(PYTHON) backend/manage.py runserver 127.0.0.1:8000 & api=$$!; \
	cd backend && ../$(CELERY) -A recallos worker -l info & worker=$$!; \
	cd client && $(NPM) run dev -- --host 127.0.0.1 & frontend=$$!; \
	trap 'kill $$api $$worker $$frontend 2>/dev/null || true' INT TERM EXIT; \
	wait $$api $$worker $$frontend
