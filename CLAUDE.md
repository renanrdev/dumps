# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # local dev server at http://localhost:8787 (wrangler dev)
npm test             # run all tests once (vitest run)
npm run test:watch   # vitest in watch mode
npm run build        # type-check only (tsc --noEmit) — no emit step, wrangler bundles src directly
npm run deploy       # deploy to production
npm run deploy:staging
```

Run a single test file:
```bash
npx vitest run test/scanner.test.ts
```

## Architecture

TypeScript Cloudflare Workers project following Clean Architecture. Dependencies flow inward: `handlers → application → domain ← infrastructure`.

```
src/
  index.ts              — entry point: Env interface, router, exports RateLimiterDO
  domain/               — pure functions, no I/O, no Cloudflare deps
    paste.ts            — types (PasteMetadata, TTLOption, RedactionMode), parseTTL, detectLang
    scanner.ts          — RULES array + scan(content, mode) → ScanResult
    id_generator.ts     — generateId() (base62 CSPRNG), generateDeletionToken() (SHA-256 hash)
  application/          — use cases, depend on port interfaces only
    create_paste.ts     — validate → scan → store blob → store metadata → return URL
    get_paste.ts        — fetch metadata + blob, lazy expiry check
    delete_paste.ts     — verify deletion token hash, remove blob + metadata
  infrastructure/       — Cloudflare binding adapters
    blob_store.ts       — BlobStore interface + R2BlobStore (PASTE_BUCKET binding)
    meta_store.ts       — MetadataStore interface + KVMetadataStore (PASTE_META binding)
    rate_limiter.ts     — RateLimiterDO (Durable Object, one instance per IP) + checkRateLimit()
  handlers/
    create.ts / get.ts / delete.ts / health.ts
    shared.ts           — securityHeaders() and htmlSecurityHeaders() (CSP, HSTS, etc.)
```

**Cloudflare bindings** (wrangler.toml → Env interface in index.ts):
- `PASTE_BUCKET` → R2 (blobs stored at key `blob/{id}`)
- `PASTE_META` → KV (JSON metadata at key `paste:{id}`, TTL via `expirationTtl`)
- `RATE_LIMITER` → Durable Objects (token bucket, 20 burst / 2 per second)

**Request routing** in `index.ts`: manual regex matching — no router library. Pattern: `^/([A-Za-z0-9]{5,20})$`.

**HTML generation**: inline template strings in `handlers/get.ts` (view page) and `src/index.ts` (landing page). All CSS is inline — no external stylesheets. Design: near-black (`#111`), red accent (`#c0392b`), `SF Mono` font.

**Secret scanner**: regex rules in `domain/scanner.ts`. Each rule captures the secret in group 1; the scan engine replaces only that capture. Three modes: `warn` (no change), `mask` (default, replaces with `‹REDACTED:type›`), `block` (rejects with 422). Scanner runs server-side on every paste; the same domain code is intended for client-side use too.

**Tests** use Vitest in Node environment with in-memory fakes (no real R2/KV). Tests for the infrastructure adapters against real bindings would require `@cloudflare/vitest-pool-workers`.

## Key invariants

- Raw content is **always** served as `text/plain` — never `text/html`. Enforced in `handleGetRaw`.
- HTML pages use `Content-Security-Policy: default-src 'none'; ... connect-src 'self'` — the `connect-src 'self'` is required for the copy button (`fetch('/raw/{id}')`).
- Deletion tokens are never stored — only their SHA-256 hash (`sha256:{hex}`) is persisted in KV.
- Blob write precedes metadata write intentionally: orphaned blobs are cleaned by R2 lifecycle rules; orphaned metadata pointing to a missing blob is handled by `get_paste.ts` returning not-found.
- `RateLimiterDO` must be exported from `index.ts` (Cloudflare requirement for DO classes).
