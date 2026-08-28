#!/bin/sh
set -e

# Apply pending migrations before serving.
#
# Done here rather than in the build so the schema changes land exactly when a
# container actually starts, and so the image stays reproducible without a
# database. If it fails the container stops: serving against a schema the code
# does not expect corrupts data quietly, which is worse than being down.
if [ -n "$DATABASE_URL" ]; then
  echo "==> applying migrations"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "==> DATABASE_URL unset, skipping migrations" >&2
fi

echo "==> starting Quant AI"
exec "$@"
