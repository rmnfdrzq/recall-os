# 1. Base Image
FROM python:3.11-slim as builder

# 2. Build environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# 3. Install compiler tools and library headers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 4. Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Final Stage
FROM python:3.11-slim as runner

WORKDIR /app

# 6. Copy installed packages from builder
COPY --from=builder /usr/local /usr/local

# 7. Install runtime Postgres libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# 8. Copy Django source code
COPY backend/ /app/
COPY ai-services/ /ai-services/

# 9. Copy entrypoint launcher
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 10. Security: run app under a non-privileged system user
RUN useradd --create-home -u 8888 django-user && chown -R django-user:django-user /app /ai-services
USER django-user

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
