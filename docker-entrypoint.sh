#!/bin/sh
set -e

MIGRATOR=/app/migrator
PRISMA="$MIGRATOR/node_modules/prisma/build/index.js"

# Apply pending migrations before serving.
#
# Run at start rather than during the build, so schema changes land when a
# container actually starts and the image stays reproducible without a database.
#
# Executed from $MIGRATOR because prisma.config.ts imports dotenv and
# prisma/config, and its schema and migrations paths are relative — running
# anywhere else leaves those unresolvable.
if [ -z "$DATABASE_URL" ]; then
  echo "==> DATABASE_URL unset, skipping migrations" >&2
elif [ ! -f "$PRISMA" ]; then
  echo "==> prisma CLI missing at $PRISMA, skipping migrations" >&2
else
  echo "==> applying migrations"
  ( cd "$MIGRATOR" && node "$PRISMA" migrate deploy )
fi

echo "==> starting Quant AI"
exec "$@"
