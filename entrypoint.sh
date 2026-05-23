#!/bin/sh

# Fail immediately if any command returns a non-zero exit status
set -e

echo "--> Running Database Migrations..."
python manage.py migrate --noinput

echo "--> Gathering Static Files..."
python manage.py collectstatic --noinput

echo "--> Booting Gunicorn Server..."
exec gunicorn recallos.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --timeout 120 \
    --access-logfile -
