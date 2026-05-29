// test/setup.ts — Vitest global setup.
//
// The worker code uses the Web Crypto API via the `crypto` global, which is
// guaranteed in the Cloudflare Workers runtime and in Node 20+. Node 18 (still
// in the CI matrix for CLI compatibility) does NOT expose it as a global, so we
// shim it from node:crypto's webcrypto. No-op on runtimes that already have it.
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
