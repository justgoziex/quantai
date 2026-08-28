# Quant AI

Signal-grade screening and token launching for memecoins on **Ethereum** and
**BNB Smart Chain**. Analytics, not financial advice — every output is a
score or a signal, never a guarantee.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind (token-driven design system,
see `/style-guide`) · Framer Motion · Privy (auth + embedded non-custodial
wallets). Prisma + PostgreSQL, live on-chain data, and the contract factory
arrive in later phases.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in what you have (see below)
npm run dev                  # http://localhost:3000
```

The app runs fully without env vars — auth surfaces switch to a
"setup required" state until configured.

### Enable sign-in + wallets

1. Create a free app at [dashboard.privy.io](https://dashboard.privy.io)
2. Enable **Email** and **Google** login methods
3. Embedded wallets → EVM → *create on login for users without wallets*
4. Put the App ID in `.env.local` as `NEXT_PUBLIC_PRIVY_APP_ID`

Sign-in methods: **email OTP** (sign-up and sign-in are the same flow) and
**Google**. An embedded wallet is provisioned on first login; keys are
split client-side (Shamir 2-of-3) — the server never sees them.

## Brand

Identity assets live in `brand/final/` (SVG + PNG exports of the Signal Q
mark, wordmark, lockups, favicons). Palette: Ink `#0A0A09` · Bone `#E9E6DD`
· Signal Amber `#EEA02B`. Type: Geist / Geist Mono. Full tokens in
`app/globals.css` + `tailwind.config.ts`; living reference at `/style-guide`.
