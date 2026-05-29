// infrastructure/meta_store.ts — KV adapter implementing the MetadataStore port.

import type { PasteMetadata } from "../domain/paste.js";

export interface MetadataStore {
  put(meta: PasteMetadata, ttlSeconds: number): Promise<void>;
  get(id: string): Promise<PasteMetadata | null>;
  delete(id: string): Promise<void>;
}

const KEY_PREFIX = "paste:";

/**
 * KVMetadataStore — adapter over Cloudflare KV namespace binding.
 * TTL is enforced both by KV expiration and by expires_at in the metadata itself
 * (dual-TTL per ADR-007 backstop strategy).
 */
export class KVMetadataStore implements MetadataStore {
  constructor(private readonly kv: KVNamespace) {}

  async put(meta: PasteMetadata, ttlSeconds: number): Promise<void> {
    await this.kv.put(KEY_PREFIX + meta.id, JSON.stringify(meta), {
      expirationTtl: ttlSeconds,
    });
  }

  async get(id: string): Promise<PasteMetadata | null> {
    const raw = await this.kv.get(KEY_PREFIX + id, "text");
    if (raw === null) return null;

    let parsed: PasteMetadata;
    try {
      parsed = JSON.parse(raw) as PasteMetadata;
    } catch {
      return null;
    }

    // Enforce expiry in case KV TTL hasn't kicked in yet (edge case).
    const now = Math.floor(Date.now() / 1000);
    if (parsed.expires_at > 0 && now > parsed.expires_at) {
      await this.delete(id);
      return null;
    }

    return parsed;
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(KEY_PREFIX + id);
  }
}
