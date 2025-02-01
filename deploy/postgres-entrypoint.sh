#!/bin/sh

DATA_VOL="/var/lib/postgresql"
PGDATA="$DATA_VOL/data"
PASSWORD_FILE="$DATA_VOL/.pg_su_password"

# If password file does not exist, generate and store a new password
if [ ! -f "$PASSWORD_FILE" ]; then
    echo "Generating new superuser password..."
    openssl rand -base64 24 | tr -d '=' | cut -c1-20 > "$PASSWORD_FILE"
    chmod 600 "$PASSWORD_FILE"
fi

export POSTGRES_PASSWORD=$(cat "$PASSWORD_FILE")

# Show the password before starting the database
echo "================================================"
echo " Setup superuser password: $POSTGRES_PASSWORD"
echo "================================================"
echo
echo "If you have manually changed the password, it's not reflected here."
echo

# Start PostgreSQL (runs the init scripts like postgres-init.sql)
exec docker-entrypoint.sh postgres
