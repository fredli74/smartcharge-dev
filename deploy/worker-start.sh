#!/bin/sh

# Default PostgreSQL connection URL (overrideable)
POSTGRES_URL="${POSTGRES_URL:-postgres://scserver:scserver@postgres:5432/smartcharge}"

# Check if INTERNAL_SERVICE_TOKEN is set
if [ -z "$INTERNAL_SERVICE_TOKEN" ]; then
  echo "INTERNAL_SERVICE_TOKEN is not set. Fetching from PostgreSQL..."

  # Query PostgreSQL using the connection URL
  INTERNAL_SERVICE_TOKEN=$(psql "$POSTGRES_URL" -Atc \
    "SELECT api_token FROM account WHERE name = 'internal';")

  # Check if token was fetched
  if [ -z "$INTERNAL_SERVICE_TOKEN" ]; then
    echo "Failed to fetch INTERNAL_SERVICE_TOKEN. Exiting."
    exit 1
  fi

  echo "Fetched INTERNAL_SERVICE_TOKEN successfully."
fi

# Export it for the worker process
export INTERNAL_SERVICE_TOKEN
echo "Using INTERNAL_SERVICE_TOKEN: $INTERNAL_SERVICE_TOKEN"

# Start the worker with the token
exec node dist/server/agency.js -d "$INTERNAL_SERVICE_TOKEN" "$SERVER_URL"
