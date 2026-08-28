# Quant AI

On-chain token screening for memecoins across **Solana**, **Ethereum**, **BNB
Chain**, **Base** and **Robinhood Chain**. Every new pair is scored 0–100 by ten
documented risk gates before it reaches the feed, and an AI desk layer reads the
full dossier and returns a verdict with its reasoning shown.

Analytics, not financial advice — every output is a score or a read, never a
guarantee. A token can pass every gate and still go to zero.

Live at **[quantniumai.com](https://quantniumai.com)**.

## What it does

**Screening.** New pairs are discovered continuously from on-chain pool data and
screened as they appear. The checks are the ones that decide whether a token can
be sold at all: honeypot simulation, LP lock and burn, holder concentration,
buy/sell tax, liquidity depth, mint authority, contract verification, deployer
history, momentum, and price trend.

**Scoring.** Those ten gates carry published weights summing to 100, documented
at [`/scoring`](https://quantniumai.com/scoring). Some are disqualifying rather
than weighted — a failed sell simulation removes a token from the feed entirely,
and an open mint authority caps the score at 40 however well everything else
scores. The useful output is often the refusal.

**Desk analysis.** An AI layer reads the assembled dossier and returns a verdict
framed as expected value and variance rather than certainty, citing the numbers
that drove it.

**Trading.** Non-custodial swaps — Jupiter routing on Solana, Uniswap V2/V3 and
PancakeSwap on the EVM chains — signed by the user's own wallet.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind (token-driven design system, see
`/style-guide`) · Framer Motion · Privy for auth and embedded non-custodial
wallets · Prisma + PostgreSQL · Solana web3.js and Jupiter · viem for EVM.

Deployed as a container on self-hosted Coolify behind Traefik.

## Run it

```bash
npm install                  # .npmrc sets legacy-peer-deps; Privy's Solana
                             # peer ranges fail strict resolution without it
cp .env.example .env.local   # fill in what you have (see below)
npx prisma generate
npm run dev                  # http://localhost:3000
```

A database is required for most pages. `DATABASE_URL` may point at a local
Postgres; `npx prisma migrate deploy` applies the schema.

## Configuration

Nothing secret is committed. `.env.example` lists every variable with
placeholders; the values live only in `.env.local` and in the deployment's
encrypted environment.

The app degrades rather than crashes when a key is absent — screening still runs
without an AI provider, and pages that query an unreachable database fall back
instead of failing the build.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | Postgres; the direct URL bypasses any pooler for migrations |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Auth and embedded wallets. The origin must be allowlisted in Privy or sign-in fails |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin — drives canonical tags, sitemap and OG cards |
| `GROQ_API_KEY`, `GROQ_MODEL` | Desk analysis. Pin the model: Groq retires them, and an unset default eventually 404s |
| `GEMINI_API_KEY` | Desk analysis fallback |
| `HELIUS_API_KEY`, `QUICKNODE_SOLANA_RPC` | Solana RPC |
| `ETHERSCAN_API_KEY`, `BIRDEYE_API_KEY`, `ZEROX_API_KEY` | EVM explorer data, market data, swap routing |
| `BOT_WALLET_SECRET` | Encrypts custodial Telegram bot wallets. **Not rotatable** — changing it makes existing bot wallets unrecoverable |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram terminal and its webhook |

## Deployment

The `Dockerfile` builds a standalone Next server in three stages and runs as an
unprivileged user. Migrations run at container start, not during the build, so
the image stays reproducible without a database.

`NEXT_PUBLIC_*` variables are compiled into the client bundle and must be present
at build time — changing one requires a rebuild with the cache disabled, or the
old value survives in the bundle.
