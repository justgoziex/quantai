#!/bin/sh
set -e

PRISMA=/app/migrator/node_modules/prisma/build/index.js

# Apply pending migrations before serving.
#
# Run here rather than during the build so schema changes land when a container
# actually starts, and so the image stays reproducible without a database.
#
# The database was migrated as part of the move from Neon, so on a healthy
# deploy this finds nothing to do. It still runs, because the next schema change
# has to reach production somehow, and a deploy is the moment to apply it.
if [ -z "$DATABASE_URL" ]; then
  echo "==> DATABASE_URL unset, skipping migrations" >&2
elif [ ! -f "$PRISMA" ]; then
  echo "==> prisma CLI missing at $PRISMA, skipping migrations" >&2
else
  echo "==> applying migrations"
  node "$PRISMA" migrate deploy
fi

echo "==> starting Quant AI"
exec "$@"
