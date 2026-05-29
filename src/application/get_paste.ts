// application/get_paste.ts — GetPaste use case.

import type { PasteMetadata } from "../domain/paste.js";
import type { BlobStore } from "../infrastructure/blob_store.js";
import type { MetadataStore } from "../infrastructure/meta_store.js";

export interface GetPasteResult {
  meta: PasteMetadata;
  content: Uint8Array;
}

export type GetPasteOutcome =
  | { ok: true; result: GetPasteResult }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" };

export async function getPaste(
  id: string,
  blobStore: BlobStore,
  metaStore: MetadataStore
): Promise<GetPasteOutcome> {
  // 1. Fetch metadata.
  const meta = await metaStore.get(id);
  if (meta === null) {
    return { ok: false, code: "NOT_FOUND" };
  }

  // 2. Double-check expiry (belt-and-suspenders).
  const now = Math.floor(Date.now() / 1000);
  if (meta.expires_at > 0 && now > meta.expires_at) {
    // Clean up lazily.
    await Promise.allSettled([
      metaStore.delete(id),
      blobStore.delete(meta.blob_key),
    ]);
    return { ok: false, code: "EXPIRED" };
  }

  // 3. Fetch blob.
  const content = await blobStore.get(meta.blob_key);
  if (content === null) {
    // Blob missing but metadata exists — treat as expired/not-found.
    await metaStore.delete(id);
    return { ok: false, code: "NOT_FOUND" };
  }

  // 4. Burn-after-read: delete immediately after fetching content.
  if (meta.burn) {
    await Promise.allSettled([
      metaStore.delete(id),
      blobStore.delete(meta.blob_key),
    ]);
  }

  return { ok: true, result: { meta, content } };
}
