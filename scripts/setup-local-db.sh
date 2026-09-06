#!/usr/bin/env bash
# Creates the gateway role and database and sets the role's password, targeting
# the exact server DATABASE_URL points at, then verifies that the application's
# own credentials work. Safe to run more than once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read one key out of .env without sourcing it: the file holds values such as
# the wallet mnemonic that are not valid shell.
env_value() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ROOT/.env" | tail -1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

URL="${DATABASE_URL:-$(env_value DATABASE_URL)}"
URL="${URL:-postgres://postgres:hyperbola@localhost:5432/gateway}"
CREDS="${URL#*://}"
USERPASS="${CREDS%%@*}"
HOSTPART="${CREDS#*@}"
DB_USER="${USERPASS%%:*}"
DB_PASSWORD="${USERPASS#*:}"
DB_HOST="${HOSTPART%%:*}"
REST="${HOSTPART#*:}"
DB_PORT="${REST%%/*}"
DB_NAME="${REST#*/}"
DB_NAME="${DB_NAME%%\?*}"

echo "target: host=$DB_HOST port=$DB_PORT user=$DB_USER db=$DB_NAME"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL first:" >&2
  echo "  brew install postgresql@16 && brew services start postgresql@16" >&2
  echo "  echo 'export PATH=\"/opt/homebrew/opt/postgresql@16/bin:\$PATH\"' >> ~/.zshrc" >&2
  exit 1
fi

# Find an account that can ALTER ROLE on the server the application talks to.
# The connection is made over TCP, exactly as the application makes it, so a
# second server reachable only over the Unix socket cannot be fixed by mistake.
ADMIN=""
for candidate in "$USER" postgres "$DB_USER"; do
  [ -n "$candidate" ] || continue
  if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$candidate" -d postgres \
       -tAc "SELECT 1" >/dev/null 2>&1; then
    ADMIN="$candidate"
    break
  fi
done

if [ -z "$ADMIN" ]; then
  echo "Could not open an administrative connection to $DB_HOST:$DB_PORT." >&2
  echo "Check what is listening there:" >&2
  echo "  lsof -nP -iTCP:$DB_PORT -sTCP:LISTEN" >&2
  echo "  docker ps --filter publish=$DB_PORT" >&2
  echo "If a container holds the port, stop it (docker compose down) or start" >&2
  echo "Homebrew PostgreSQL (brew services start postgresql@16)." >&2
  exit 1
fi

run() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN" -d postgres "$@"; }

echo "connected as: $ADMIN"
echo "server:       $(run -tAc 'SHOW server_version')"
echo "data dir:     $(run -tAc 'SHOW data_directory' 2>/dev/null || echo '(not visible, likely a container)')"

if run -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'" | grep -q 1; then
  echo "role ${DB_USER} already exists"
else
  run -c "CREATE ROLE ${DB_USER}" >/dev/null
  echo "created role ${DB_USER}"
fi

run -c "ALTER ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASSWORD}'" >/dev/null
echo "password set for role ${DB_USER}"

if run -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  echo "database ${DB_NAME} already exists"
else
  run -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}" >/dev/null
  echo "created database ${DB_NAME}"
fi

# Prove the application's own credentials work before reporting success.
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
     -tAc "SELECT 1" >/dev/null 2>&1; then
  echo
  echo "Verified. $DB_USER can sign in to $DB_NAME at $DB_HOST:$DB_PORT."
else
  echo
  echo "The role was updated but signing in as ${DB_USER} still fails." >&2
  echo "Something else is answering on $DB_HOST:$DB_PORT. Check:" >&2
  echo "  lsof -nP -iTCP:$DB_PORT -sTCP:LISTEN" >&2
  echo "  docker ps --filter publish=$DB_PORT" >&2
  exit 1
fi
