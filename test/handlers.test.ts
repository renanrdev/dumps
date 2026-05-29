// test/handlers.test.ts — HTTP handler integration tests.
// Uses vi.mock to stub cloudflare:workers and in-memory fakes for R2/KV.

import { vi, describe, it, expect, beforeEach } from "vitest";

// Must be declared before any import that transitively depends on cloudflare:workers.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import worker from "../src/index.js";
import type { Env } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fake Cloudflare bindings
// ---------------------------------------------------------------------------

class FakeR2Bucket {
  readonly store = new Map<string, Uint8Array>();

  async put(key: string, value: Uint8Array | ArrayBuffer, _opts?: unknown): Promise<void> {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    this.store.set(key, bytes);
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const data = this.store.get(key);
    if (!data) return null;
    return {
      arrayBuffer: async () => data.buffer as ArrayBuffer,
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class FakeKVNamespace {
  readonly store = new Map<string, string>();

  async put(key: string, value: string, _opts?: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string, _type?: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeRateLimiter(allowed = true) {
  return {
    idFromName: (_ip: string) => "fake-do-id",
    get: (_id: unknown) => ({
      checkLimit: async () => ({ allowed, remaining: allowed ? 19 : 0 }),
    }),
  };
}

function makeEnv(overrides: Partial<{ rateLimitAllowed: boolean }> = {}): Env {
  return {
    PASTE_BUCKET: new FakeR2Bucket() as unknown as R2Bucket,
    PASTE_META: new FakeKVNamespace() as unknown as KVNamespace,
    RATE_LIMITER: makeRateLimiter(overrides.rateLimitAllowed ?? true) as unknown as Env["RATE_LIMITER"],
  };
}

// Convenience wrapper — returns the same env so state is shared across requests.
function makeEnvWithState() {
  const r2 = new FakeR2Bucket();
  const kv = new FakeKVNamespace();
  const env: Env = {
    PASTE_BUCKET: r2 as unknown as R2Bucket,
    PASTE_META: kv as unknown as KVNamespace,
    RATE_LIMITER: makeRateLimiter(true) as unknown as Env["RATE_LIMITER"],
  };
  return env;
}

const ctx = {} as ExecutionContext;

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe("GET /healthz", () => {
  it("returns 200 JSON { status: ok }", async () => {
    const res = await worker.fetch(new Request("https://dumps.sh/healthz"), makeEnv(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

describe("GET /", () => {
  it("returns 200 HTML landing page", async () => {
    const res = await worker.fetch(new Request("https://dumps.sh/"), makeEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("dumps.sh");
  });

  it("includes security headers", async () => {
    const res = await worker.fetch(new Request("https://dumps.sh/"), makeEnv(), ctx);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

// ---------------------------------------------------------------------------
// POST / — create paste
// ---------------------------------------------------------------------------

describe("POST / — create paste", () => {
  it("returns 201 plain text URL for curl user-agent", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "hello world",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(body.trim()).toMatch(/^https:\/\/dumps\.sh\/[A-Za-z0-9]{10}$/);
  });

  it("returns deletion token header on create", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "hello",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.headers.get("X-Deletion-Token")).toMatch(/^del_/);
    expect(res.headers.get("X-Paste-ID")).toMatch(/^[A-Za-z0-9]{10}$/);
  });

  it("returns 201 JSON for browser requests (no curl UA)", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "hello world",
        headers: { "User-Agent": "Mozilla/5.0" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const json = await res.json() as { id: string; url: string; deletion_token: string };
    expect(json.id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(json.url).toMatch(/^https:\/\/dumps\.sh\//);
    expect(json.deletion_token).toMatch(/^del_/);
  });

  it("returns 201 plain text for X-Dumps-Plain: 1", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "hello",
        headers: { "User-Agent": "Mozilla/5.0", "X-Dumps-Plain": "1" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("returns 400 for empty body", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(400);
  });

  it("returns 413 for body over 1 MB", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: big,
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(413);
  });

  it("returns 422 for secrets in block mode", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/?redact=block", {
        method: "POST",
        body: "AKIAIOSFODNN7EXAMPL3",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(422);
  });

  it("returns 429 when rate limit exceeded", async () => {
    const env = makeEnv({ rateLimitAllowed: false });
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "hello",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("sets X-Redaction-Applied header when content is masked", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "AKIAIOSFODNN7EXAMPL3",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("X-Redaction-Applied")).toBe("true");
    expect(res.headers.get("X-Redaction-Types")).toContain("aws_access_key_id");
  });

  it("respects ?ttl= parameter", async () => {
    const env = makeEnvWithState();
    const res = await worker.fetch(
      new Request("https://dumps.sh/?ttl=10m", {
        method: "POST",
        body: "short-lived",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );

    expect(res.status).toBe(201);
    // Retrieve the ID from the URL.
    const url = (await res.text()).trim();
    const id = url.split("/").pop()!;

    const kv = (env.PASTE_META as unknown as FakeKVNamespace);
    const raw = await kv.get(`paste:${id}`);
    const meta = JSON.parse(raw!);
    const ttlSeconds = meta.expires_at - meta.created_at;
    expect(ttlSeconds).toBe(10 * 60);
  });

  it("respects ?lang= parameter", async () => {
    const env = makeEnvWithState();
    const res = await worker.fetch(
      new Request("https://dumps.sh/?lang=python", {
        method: "POST",
        body: "print('hello')",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );

    const url = (await res.text()).trim();
    const id = url.split("/").pop()!;
    const kv = (env.PASTE_META as unknown as FakeKVNamespace);
    const raw = await kv.get(`paste:${id}`);
    const meta = JSON.parse(raw!);
    expect(meta.detected_lang).toBe("python");
  });
});

// ---------------------------------------------------------------------------
// GET /raw/{id} and GET /{id}
// ---------------------------------------------------------------------------

describe("GET /raw/{id}", () => {
  it("returns 200 text/plain with paste content", async () => {
    const env = makeEnvWithState();

    // Create a paste.
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "raw content here",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const pasteUrl = (await createRes.text()).trim();
    const id = pasteUrl.split("/").pop()!;

    const rawRes = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );

    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get("Content-Type")).toContain("text/plain");
    expect(rawRes.headers.get("Content-Disposition")).toBe("inline");
    const text = await rawRes.text();
    expect(text).toBe("raw content here");
  });

  it("returns 404 for non-existent paste", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/raw/doesNotExist"),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("never returns text/html content type", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "<script>alert(1)</script>",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    const rawRes = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );

    expect(rawRes.headers.get("Content-Type")).not.toContain("text/html");
  });
});

describe("GET /{id} — HTML view", () => {
  it("returns 200 HTML for existing paste", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "view me",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    const viewRes = await worker.fetch(
      new Request(`https://dumps.sh/${id}`),
      env,
      ctx
    );

    expect(viewRes.status).toBe(200);
    expect(viewRes.headers.get("Content-Type")).toContain("text/html");
    const html = await viewRes.text();
    expect(html).toContain("view me");
    expect(html).toContain("dumps.sh");
  });

  it("returns 404 HTML for non-existent paste", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/doesNotExist"),
      makeEnv(),
      ctx
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("paste not found or has expired");
  });

  it("includes security headers on HTML view", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "secured",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    const viewRes = await worker.fetch(new Request(`https://dumps.sh/${id}`), env, ctx);

    expect(viewRes.headers.get("X-Frame-Options")).toBe("DENY");
    expect(viewRes.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});

// ---------------------------------------------------------------------------
// DELETE /{id}
// ---------------------------------------------------------------------------

describe("DELETE /{id}", () => {
  it("returns 204 for valid deletion token", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "deletable",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;
    const token = createRes.headers.get("X-Deletion-Token")!;

    const delRes = await worker.fetch(
      new Request(`https://dumps.sh/${id}`, {
        method: "DELETE",
        headers: { "X-Deletion-Token": token },
      }),
      env,
      ctx
    );

    expect(delRes.status).toBe(204);
  });

  it("paste is inaccessible after deletion", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "gone",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;
    const token = createRes.headers.get("X-Deletion-Token")!;

    await worker.fetch(
      new Request(`https://dumps.sh/${id}`, {
        method: "DELETE",
        headers: { "X-Deletion-Token": token },
      }),
      env,
      ctx
    );

    const getRes = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );
    expect(getRes.status).toBe(404);
  });

  it("returns 403 when no deletion token is provided", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "protected",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    const delRes = await worker.fetch(
      new Request(`https://dumps.sh/${id}`, { method: "DELETE" }),
      env,
      ctx
    );

    expect(delRes.status).toBe(403);
  });

  it("returns 403 for wrong deletion token", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "protected",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    const delRes = await worker.fetch(
      new Request(`https://dumps.sh/${id}`, {
        method: "DELETE",
        headers: { "X-Deletion-Token": "del_wrong_token_xxx" },
      }),
      env,
      ctx
    );

    expect(delRes.status).toBe(403);
  });

  it("returns 403 for non-existent paste (prevents existence enumeration)", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/doesNotExist", {
        method: "DELETE",
        headers: { "X-Deletion-Token": "del_anything" },
      }),
      makeEnv(),
      ctx
    );

    // Must be 403, not 404 — attacker must not distinguish "ID doesn't exist"
    // from "ID exists but token is wrong".
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Burn-after-read (?burn=1)
// ---------------------------------------------------------------------------

describe("?burn=1 — destroy after first read", () => {
  it("stores burn=true in metadata", async () => {
    const env = makeEnvWithState();
    const res = await worker.fetch(
      new Request("https://dumps.sh/?burn=1", {
        method: "POST",
        body: "one-time",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await res.text()).trim();
    const id = url.split("/").pop()!;

    const kv = env.PASTE_META as unknown as FakeKVNamespace;
    const meta = JSON.parse((await kv.get(`paste:${id}`))!);
    expect(meta.burn).toBe(true);
  });

  it("stores a secret verbatim (burn implies no masking)", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/?burn=1", {
        method: "POST",
        body: "AKIAIOSFODNN7EXAMPL3",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );

    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    // The stored blob is the raw secret, NOT a ‹REDACTED:…› placeholder —
    // burn-after-read implies warn mode so the credential can be shared.
    const r2 = env.PASTE_BUCKET as unknown as FakeR2Bucket;
    const blob = await r2.get(`blob/${id}`);
    const stored = new TextDecoder().decode(await blob!.arrayBuffer());
    expect(stored).toBe("AKIAIOSFODNN7EXAMPL3");

    const readRes = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );
    expect(await readRes.text()).toBe("AKIAIOSFODNN7EXAMPL3");
  });

  it("still blocks secrets when burn is combined with explicit redact=block", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/?burn=1&redact=block", {
        method: "POST",
        body: "AKIAIOSFODNN7EXAMPL3",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(422);
  });

  it("first raw read returns content", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/?burn=1", {
        method: "POST",
        body: "secret-once",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    const readRes = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );

    expect(readRes.status).toBe(200);
    expect(await readRes.text()).toBe("secret-once");
  });

  it("second raw read returns 404", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/?burn=1", {
        method: "POST",
        body: "burn me",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    await worker.fetch(new Request(`https://dumps.sh/raw/${id}`), env, ctx);
    const secondRead = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );

    expect(secondRead.status).toBe(404);
  });

  it("non-burn paste remains accessible after read", async () => {
    const env = makeEnvWithState();
    const createRes = await worker.fetch(
      new Request("https://dumps.sh/", {
        method: "POST",
        body: "persistent",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      env,
      ctx
    );
    const url = (await createRes.text()).trim();
    const id = url.split("/").pop()!;

    await worker.fetch(new Request(`https://dumps.sh/raw/${id}`), env, ctx);
    const secondRead = await worker.fetch(
      new Request(`https://dumps.sh/raw/${id}`),
      env,
      ctx
    );

    expect(secondRead.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Routing edge cases
// ---------------------------------------------------------------------------

describe("routing", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await worker.fetch(
      new Request("https://dumps.sh/unknown/nested/path"),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(404);
  });

  it("normalizes trailing slash", async () => {
    // POST / and POST // should both be treated as root.
    const res = await worker.fetch(
      new Request("https://dumps.sh//", {
        method: "POST",
        body: "test",
        headers: { "User-Agent": "curl/8.1.2" },
      }),
      makeEnv(),
      ctx
    );
    // trailing slash is stripped → POST / → 201
    expect(res.status).toBe(201);
  });
});
