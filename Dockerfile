# syntax=docker/dockerfile:1

###############################################################################
# Quant AI — production image
#
# Three stages so the runtime carries only what it needs to serve:
#   deps    installs node_modules (and generates the Prisma client via
#           postinstall, since lib/generated is gitignored and never committed)
#   builder compiles Next into .next/standalone
#   runner  runs as an unprivileged user with the traced output only
#
# Migrations deliberately do NOT run here. A build that needs the database is a
# build that cannot be reproduced, and applying schema changes while an image is
# being assembled means they land whether or not that image is ever deployed.
# They run at container start instead — see docker-entrypoint.sh.
###############################################################################

FROM node:22-alpine AS deps
WORKDIR /app
# openssl for Prisma's query engine; the toolchain because ws pulls in
# bufferutil/utf-8-validate, which are native and compile from source on alpine.
RUN apk add --no-cache libc6-compat openssl python3 make g++
# .npmrc carries legacy-peer-deps, without which Privy's Solana peer ranges
# make npm fail resolution here even though it installs cleanly locally.
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci


FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Baked into the client bundle at build time, so they must be present now.
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Prerendering touches the database. A URL that parses but resolves nowhere lets
# Prisma initialise; the pages that query it already fall back when it is
# unreachable, so the build completes without a live server.
ARG DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?sslmode=disable"
ENV DATABASE_URL=$DATABASE_URL

ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build:image


FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone server, plus the assets it does not trace.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma CLI for start-up migrations.
#
# Copying just the prisma and @prisma packages is not enough: the CLI requires
# its own transitive dependencies, and cherry-picking them left it resolving a
# module that was not there. The full tree goes under migrator/node_modules so
# Node's upward lookup satisfies those requires without polluting the traced
# standalone modules the server itself uses.
#
# Prisma 7 reads datasource.url from prisma.config.ts, and that file imports
# dotenv and prisma/config — modules that exist only in the full tree. Config,
# schema and migrations therefore all sit beside that tree, and the CLI runs
# with migrator/ as its working directory, so every relative path inside the
# config resolves exactly as it does during the build.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./migrator/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./migrator/prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./migrator/prisma.config.ts

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=8s --start-period=60s --retries=5 \
  CMD wget -qO- --timeout=6 http://127.0.0.1:3000/api/status >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
