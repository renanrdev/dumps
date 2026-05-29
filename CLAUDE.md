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

### CLI (`packages/cli`)

The CLI is a separate npm package published as **`@renanrdev/dumps`** (binary: `dumps`).

```bash
npm run build:cli                    # bundle packages/cli → dist/cli.js (tsup)
cd packages/cli && npm run typecheck # type-check the CLI only
```

**Releases are automated** via `.github/workflows/release.yml` (manual `workflow_dispatch`) + `semantic-release` (`.releaserc.json`). Versioning is driven by Conventional Commits since the last `v*` git tag — `feat:` → minor, `fix:` → patch. The pipeline: probes the next version → bumps `packages/cli/package.json` and builds → publishes `@renanrdev/dumps` to npm **with provenance** → `semantic-release` commits the bump + `CHANGELOG.md` back, tags `vX.Y.Z`, and creates the GitHub Release. The version is injected into the bundle by tsup at build time (`__CLI_VERSION__`). Requires the `NPM_TOKEN` repo secret (npm "Automation" token); `GITHUB_TOKEN` is provided automatically.

Do **not** hand-bump `version` or run `npm publish` manually — semantic-release owns versioning. For a one-off manual publish, build first (`npm run build:cli`) since `npm publish` alone ships whatever stale `dist/` exists.

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
packages/cli/           — npm package `@renanrdev/dumps` (binary `dumps`), Node 18+, zero runtime deps
  src/cli.ts            — single-file CLI: stdin upload, get, delete, config; manual arg parsing
  dist/cli.js           — tsup bundle (the published bin)
```

**CLI** (`packages/cli/src/cli.ts`): talks to the same HTTP API as `curl`. Default endpoint is `https://dumps.sh`, overridable via `~/.dumps/config.json` (`dumps config set url …`) — note this config file takes precedence over the default, so a stale `http://localhost:8787` left from `wrangler dev` will silently redirect uploads. Deletion tokens are auto-saved to `~/.dumps/tokens.json` (chmod 600) on upload.

**Cloudflare bindings** (wrangler.toml → Env interface in index.ts):
- `PASTE_BUCKET` → R2 (blobs stored at key `blob/{id}`)
- `PASTE_META` → KV (JSON metadata at key `paste:{id}`, TTL via `expirationTtl`)
- `RATE_LIMITER` → Durable Objects (token bucket, 20 burst / 2 per second)

**Request routing** in `index.ts`: manual regex matching — no router library. Pattern: `^/([A-Za-z0-9]{5,20})$`.

**HTML generation**: inline template strings in `handlers/get.ts` (view page) and `src/index.ts` (landing page). All CSS is inline — no external stylesheets. Design: near-black (`#111`), red accent (`#c0392b`), `SF Mono` font.

**Secret scanner**: regex rules in `domain/scanner.ts`. Each rule captures the secret in group 1; the scan engine replaces only that capture. Three modes: `warn` (no change), `mask` (default, replaces with `‹REDACTED:type›`), `block` (rejects with 422). Scanner runs server-side on every paste; the same domain code is intended for client-side use too.

**Burn-after-read defaults to `warn`**: `?burn=1` (CLI `--burn`) is for sharing a secret exactly once, so masking it would defeat the purpose. When no explicit `redact` mode is given, `resolveRedactMode` (in `domain/paste.ts`, called from `handlers/create.ts`) makes burn imply `warn` — content stored verbatim. An explicit mode always wins (`?burn=1&redact=block` still blocks). Note `warn` still records `redaction_applied=true` in metadata (secrets *detected*, not masked), so the view badge / CLI still report detected types.

**Tests** use Vitest in Node environment with in-memory fakes (no real R2/KV). Tests for the infrastructure adapters against real bindings would require `@cloudflare/vitest-pool-workers`.

## Key invariants

- Raw content is **always** served as `text/plain` — never `text/html`. Enforced in `handleGetRaw`.
- HTML pages use `Content-Security-Policy: default-src 'none'; ... connect-src 'self'` — the `connect-src 'self'` is required for the copy button (`fetch('/raw/{id}')`).
- Deletion tokens are never stored — only their SHA-256 hash (`sha256:{hex}`) is persisted in KV.
- Blob write precedes metadata write intentionally: orphaned blobs are cleaned by R2 lifecycle rules; orphaned metadata pointing to a missing blob is handled by `get_paste.ts` returning not-found.
- `RateLimiterDO` must be exported from `index.ts` (Cloudflare requirement for DO classes).
