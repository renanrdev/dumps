// test/create.test.ts — Integration tests for the CreatePaste use case.
// Uses in-memory fakes for BlobStore and MetadataStore — no Cloudflare bindings needed.

import { describe, it, expect, beforeEach } from "vitest";
import { createPaste } from "../src/application/create_paste.js";
import type { BlobStore } from "../src/infrastructure/blob_store.js";
import type { MetadataStore } from "../src/infrastructure/meta_store.js";
import type { PasteMetadata } from "../src/domain/paste.js";

// ---------------------------------------------------------------------------
// In-memory fakes (implement the same ports as the real adapters)
// ---------------------------------------------------------------------------

class FakeBlobStore implements BlobStore {
  readonly store = new Map<string, Uint8Array>();

  async put(key: string, value: Uint8Array): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class FakeMetadataStore implements MetadataStore {
  readonly store = new Map<string, PasteMetadata>();

  async put(meta: PasteMetadata, _ttlSeconds: number): Promise<void> {
    this.store.set(meta.id, meta);
  }

  async get(id: string): Promise<PasteMetadata | null> {
    return this.store.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPaste use case", () => {
  let blobStore: FakeBlobStore;
  let metaStore: FakeMetadataStore;
  const BASE_URL = "https://dumps.sh";
  const enc = new TextEncoder();

  beforeEach(() => {
    blobStore = new FakeBlobStore();
    metaStore = new FakeMetadataStore();
  });

  it("creates a paste and returns a valid URL", async () => {
    const outcome = await createPaste(
      { content: enc.encode("hello world"), ttl: "1h", redactMode: "mask" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.url).toMatch(/^https:\/\/dumps\.sh\/[A-Za-z0-9]{10}$/);
    expect(outcome.result.deletionToken).toMatch(/^del_/);
    expect(outcome.result.redactionApplied).toBe(false);
  });

  it("stores the blob and metadata", async () => {
    const outcome = await createPaste(
      { content: enc.encode("log content"), ttl: "1d", redactMode: "mask" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { id } = outcome.result;
    expect(blobStore.store.has(`blob/${id}`)).toBe(true);
    expect(metaStore.store.has(id)).toBe(true);
  });

  it("rejects empty body", async () => {
    const outcome = await createPaste(
      { content: new Uint8Array(0), ttl: "1d", redactMode: "mask" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("EMPTY_BODY");
  });

  it("rejects payloads over 1 MB", async () => {
    const big = new Uint8Array(1024 * 1024 + 1); // 1 MB + 1 byte
    const outcome = await createPaste(
      { content: big, ttl: "1d", redactMode: "mask" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("TOO_LARGE");
  });

  it("masks AWS key in mask mode", async () => {
    const content = "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const outcome = await createPaste(
      { content: enc.encode(content), ttl: "1h", redactMode: "mask" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.redactionApplied).toBe(true);
    expect(outcome.result.redactionTypes).toContain("aws_secret_access_key");

    // Verify blob was stored with masked content.
    const { id } = outcome.result;
    const stored = blobStore.store.get(`blob/${id}`)!;
    const text = new TextDecoder().decode(stored);
    expect(text).toContain("‹REDACTED:aws_secret_access_key›");
    expect(text).not.toContain("wJalrXUtnFEMI");
  });

  it("blocks paste in block mode when secrets are found", async () => {
    const content = "GITHUB_TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a";
    const outcome = await createPaste(
      { content: enc.encode(content), ttl: "1h", redactMode: "block" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("SECRETS_BLOCKED");
    // Nothing should have been written.
    expect(blobStore.store.size).toBe(0);
    expect(metaStore.store.size).toBe(0);
  });

  it("stores content unchanged in warn mode even if secrets present", async () => {
    const content = "GITHUB_TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a";
    const outcome = await createPaste(
      { content: enc.encode(content), ttl: "1h", redactMode: "warn" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Content should be unmodified.
    const { id } = outcome.result;
    const stored = blobStore.store.get(`blob/${id}`)!;
    const text = new TextDecoder().decode(stored);
    expect(text).toBe(content);
    // But redaction info is still recorded in metadata.
    expect(outcome.result.redactionApplied).toBe(true);
  });

  it("records correct metadata fields", async () => {
    const content = "name: myapp\nversion: 1.0.0";
    const outcome = await createPaste(
      { content: enc.encode(content), ttl: "7d", redactMode: "mask", langHint: "yaml" },
      blobStore,
      metaStore,
      BASE_URL
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { id } = outcome.result;
    const meta = metaStore.store.get(id)!;
    expect(meta.id).toBe(id);
    expect(meta.detected_lang).toBe("yaml");
    expect(meta.encrypted).toBe(false);
    expect(meta.blob_key).toBe(`blob/${id}`);
    expect(meta.expires_at).toBeGreaterThan(meta.created_at);
    expect(meta.deletion_token_hash).toMatch(/^sha256:/);
  });
});
