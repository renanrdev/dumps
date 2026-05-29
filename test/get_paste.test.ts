// test/get_paste.test.ts — Tests for the GetPaste use case.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPaste } from "../src/application/get_paste.js";
import type { BlobStore } from "../src/infrastructure/blob_store.js";
import type { MetadataStore } from "../src/infrastructure/meta_store.js";
import type { PasteMetadata } from "../src/domain/paste.js";

// ---------------------------------------------------------------------------
// In-memory fakes
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
// Helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 1;

function makeMeta(overrides: Partial<PasteMetadata> = {}): PasteMetadata {
  return {
    id: "testId1234",
    created_at: Math.floor(Date.now() / 1000),
    expires_at: FAR_FUTURE,
    size: 11,
    detected_lang: "text",
    blob_key: "blob/testId1234",
    encrypted: false,
    burn: false,
    redaction_applied: false,
    redaction_types: [],
    deletion_token_hash: "sha256:abc123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getPaste — happy path", () => {
  let blobStore: FakeBlobStore;
  let metaStore: FakeMetadataStore;

  beforeEach(() => {
    blobStore = new FakeBlobStore();
    metaStore = new FakeMetadataStore();
  });

  it("returns content for an existing paste", async () => {
    const meta = makeMeta();
    await metaStore.put(meta, 86400);
    blobStore.store.set(meta.blob_key, enc.encode("hello world"));

    const outcome = await getPaste(meta.id, blobStore, metaStore);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(dec.decode(outcome.result.content)).toBe("hello world");
    expect(outcome.result.meta.id).toBe(meta.id);
  });

  it("returns NOT_FOUND when metadata is absent", async () => {
    const outcome = await getPaste("doesNotExist", blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("NOT_FOUND");
  });

  it("returns EXPIRED and deletes both entries when paste is expired", async () => {
    const meta = makeMeta({ expires_at: PAST });
    await metaStore.put(meta, 1);
    blobStore.store.set(meta.blob_key, enc.encode("old content"));

    const outcome = await getPaste(meta.id, blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("EXPIRED");

    // Both entries should be cleaned up.
    expect(metaStore.store.has(meta.id)).toBe(false);
    expect(blobStore.store.has(meta.blob_key)).toBe(false);
  });

  it("returns NOT_FOUND and cleans metadata when blob is missing", async () => {
    const meta = makeMeta();
    await metaStore.put(meta, 86400);
    // blob NOT seeded

    const outcome = await getPaste(meta.id, blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("NOT_FOUND");
    expect(metaStore.store.has(meta.id)).toBe(false);
  });
});

describe("getPaste — burn-after-read", () => {
  let blobStore: FakeBlobStore;
  let metaStore: FakeMetadataStore;

  beforeEach(() => {
    blobStore = new FakeBlobStore();
    metaStore = new FakeMetadataStore();
  });

  it("returns content on first read of a burn paste", async () => {
    const meta = makeMeta({ burn: true });
    await metaStore.put(meta, 86400);
    blobStore.store.set(meta.blob_key, enc.encode("secret"));

    const outcome = await getPaste(meta.id, blobStore, metaStore);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(dec.decode(outcome.result.content)).toBe("secret");
  });

  it("deletes paste after first read when burn=true", async () => {
    const meta = makeMeta({ burn: true });
    await metaStore.put(meta, 86400);
    blobStore.store.set(meta.blob_key, enc.encode("secret"));

    await getPaste(meta.id, blobStore, metaStore);

    expect(metaStore.store.has(meta.id)).toBe(false);
    expect(blobStore.store.has(meta.blob_key)).toBe(false);
  });

  it("second read of a burn paste returns NOT_FOUND", async () => {
    const meta = makeMeta({ burn: true });
    await metaStore.put(meta, 86400);
    blobStore.store.set(meta.blob_key, enc.encode("secret"));

    // First read consumes it.
    await getPaste(meta.id, blobStore, metaStore);
    // Second read should fail.
    const outcome = await getPaste(meta.id, blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("NOT_FOUND");
  });

  it("does NOT delete non-burn paste after read", async () => {
    const meta = makeMeta({ burn: false });
    await metaStore.put(meta, 86400);
    blobStore.store.set(meta.blob_key, enc.encode("persistent"));

    await getPaste(meta.id, blobStore, metaStore);

    expect(metaStore.store.has(meta.id)).toBe(true);
    expect(blobStore.store.has(meta.blob_key)).toBe(true);
  });
});
