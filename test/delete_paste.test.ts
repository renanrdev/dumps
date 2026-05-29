// test/delete_paste.test.ts — Tests for the DeletePaste use case.

import { describe, it, expect, beforeEach } from "vitest";
import { deletePaste } from "../src/application/delete_paste.js";
import { generateDeletionToken } from "../src/domain/id_generator.js";
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

async function seedPaste(
  metaStore: FakeMetadataStore,
  blobStore: FakeBlobStore,
  tokenHash: string
): Promise<PasteMetadata> {
  const meta: PasteMetadata = {
    id: "abc1234567",
    created_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    size: 5,
    detected_lang: "text",
    blob_key: "blob/abc1234567",
    encrypted: false,
    burn: false,
    redaction_applied: false,
    redaction_types: [],
    deletion_token_hash: tokenHash,
  };
  await metaStore.put(meta, 86400);
  blobStore.store.set(meta.blob_key, new Uint8Array([104, 101, 108, 108, 111]));
  return meta;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deletePaste", () => {
  let blobStore: FakeBlobStore;
  let metaStore: FakeMetadataStore;

  beforeEach(() => {
    blobStore = new FakeBlobStore();
    metaStore = new FakeMetadataStore();
  });

  it("succeeds with a valid deletion token", async () => {
    const { token, hash } = await generateDeletionToken();
    const meta = await seedPaste(metaStore, blobStore, hash);

    const outcome = await deletePaste(meta.id, token, blobStore, metaStore);

    expect(outcome.ok).toBe(true);
  });

  it("removes blob and metadata on success", async () => {
    const { token, hash } = await generateDeletionToken();
    const meta = await seedPaste(metaStore, blobStore, hash);

    await deletePaste(meta.id, token, blobStore, metaStore);

    expect(metaStore.store.has(meta.id)).toBe(false);
    expect(blobStore.store.has(meta.blob_key)).toBe(false);
  });

  it("returns NOT_FOUND when paste does not exist", async () => {
    const { token } = await generateDeletionToken();

    const outcome = await deletePaste("nonexistent", token, blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("NOT_FOUND");
  });

  it("returns UNAUTHORIZED when no token is provided", async () => {
    const { hash } = await generateDeletionToken();
    const meta = await seedPaste(metaStore, blobStore, hash);

    const outcome = await deletePaste(meta.id, null, blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED for a wrong token", async () => {
    const { hash } = await generateDeletionToken();
    const meta = await seedPaste(metaStore, blobStore, hash);

    const outcome = await deletePaste(meta.id, "del_wrong_token_123", blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("UNAUTHORIZED");
  });

  it("does NOT delete anything when token is wrong", async () => {
    const { hash } = await generateDeletionToken();
    const meta = await seedPaste(metaStore, blobStore, hash);

    await deletePaste(meta.id, "del_wrong_token", blobStore, metaStore);

    expect(metaStore.store.has(meta.id)).toBe(true);
    expect(blobStore.store.has(meta.blob_key)).toBe(true);
  });

  it("returns UNAUTHORIZED for an empty string token", async () => {
    const { hash } = await generateDeletionToken();
    const meta = await seedPaste(metaStore, blobStore, hash);

    const outcome = await deletePaste(meta.id, "", blobStore, metaStore);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // empty string is falsy — treated as missing token
    expect(outcome.code).toBe("UNAUTHORIZED");
  });
});
