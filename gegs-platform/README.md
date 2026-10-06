# gegs-platform

Operational platform for Golden Eagle GS: recruitment and government-service
workflows.

It runs **adjacent to** the existing WordPress site and does not replace,
rewrite, or modify it. WordPress remains solely responsible for marketing,
content, SEO, public URLs and structured content. This application owns the
authenticated operational workflow and **serves no indexed URL** — see
"The WordPress boundary" below.

Authoritative specifications, which take precedence over this file:

- `docs/00-PRODUCT-DEFINITION.md` — approved Phase 0
- `docs/01-ARCHITECTURE-AND-UX-PLAN.md` — approved Phase 1

## Status

**Milestone 0 of 10.** Scaffolding, quality gates, and the health endpoint.

No product functionality exists yet. Specifically not yet built: database schema
(M1), authentication (M2), the authorisation policy layer (M3), the design
system (M4), and every user journey (M5–M9). Nothing in this repository should
be read as a working recruitment or government-services product.

## Requirements

- Node.js 22+
- A container runtime for PostgreSQL and MinIO (`docker compose`), or a locally
  installed PostgreSQL 16 and any S3-compatible store

## Local setup

```bash
cp .env.example .env          # local fixtures; never commit a real .env
docker compose up -d          # PostgreSQL + MinIO, bucket created and private
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev                   # http://127.0.0.1:3000
```

`GET /api/health` returns `200` only when the database is reachable, object
storage is reachable, and no migration carried by this build is unapplied.
Otherwise it returns `503` with per-check detail. It deliberately does **not**
report healthy merely because the process is running.

## Quality gates

```bash
npm run gate              # lint, format, typecheck, unit tests, secret scan
npm run test:integration  # requires a real PostgreSQL via DATABASE_URL
npm run test:e2e          # requires the app running at E2E_BASE_URL
```

CI runs all of it on every push (`.github/workflows/ci.yml`). Two gates are
worth calling out:

- **`scripts/check-contrast.mjs`** measures every palette pair in
  `src/design/tokens.ts` against WCAG 2.2. Phase 1 recorded two candidate
  values that failed and were rejected; this gate stops either being
  reintroduced.
- **`scripts/secret-scan.mjs`** fails the build if a credential appears in a
  git-tracked file. It never prints the matched value, since doing so would
  copy the secret into the CI log.

## Secrets

Every secret arrives through the environment. There are no defaults that could
stand in for a credential: a missing variable makes the process refuse to start,
with a message that names the variable and never its value.

`.env.example` and `docker-compose.yml` contain **local development fixtures
only** — they are not production credentials and grant access to nothing.
Production values come from the platform secret manager and are injected at run
time.

## The WordPress boundary

Four rules, from the approved Phase 1 §1.2. They are what makes this an adjacent
product rather than a replacement:

1. No public, indexed URL. Every route requires a session except sign-in,
   registration, email verification, password reset, and legal pages.
2. `X-Robots-Tag: noindex, nofollow, noarchive` on every response, plus a
   `robots.txt` that disallows everything. WordPress SEO cannot be affected by
   anything this application does.
3. WordPress links _into_ this application. This application never writes to
   WordPress, never shares its database, and never requires a WordPress plugin.
4. **Rollback is removing that one link.** No migration to unwind, no DNS
   change, no data to restore.

## Data residency

Personal data must remain in the approved GCC region. Compute and storage are
pinned to one Gulf region; nothing is replicated outside it.

Transactional email is the one unavoidable exception: email inherently transits
the provider. Notification templates therefore carry no personal document
content and no case detail — they say only that something changed and that the
recipient should sign in.

See `docs/02-PREFLIGHT-AWS-ME-CENTRAL-1.md` for the region verification and its
open constraints. **The hosting region is not yet operationally final.**

## Layout

```
.github/workflows/ci.yml   pipeline: static gates, tests, browser checks
prisma/                    schema and forward-only migrations
scripts/                   secret scan, contrast gate
src/env.ts                 environment contract, validated at boot
src/middleware.ts          security headers and the crawler boundary
src/lib/                   db, storage, request id, API error envelope
src/design/tokens.ts       design tokens and their contrast requirements
src/app/api/health/        health endpoint
tests/unit/                pure logic
tests/integration/         against a real PostgreSQL, never a mock
tests/e2e/                 browser, accessibility, console/network
```
