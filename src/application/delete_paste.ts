// application/delete_paste.ts — DeletePaste use case.

import { verifyDeletionToken } from "../domain/id_generator.js";
import type { BlobStore } from "../infrastructure/blob_store.js";
import type { MetadataStore } from "../infrastructure/meta_store.js";

export type DeletePasteOutcome =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "UNAUTHORIZED" };

export async function deletePaste(
  id: string,
  providedToken: string | null,
  blobStore: BlobStore,
  metaStore: MetadataStore
): Promise<DeletePasteOutcome> {
  // 1. Fetch metadata.
  const meta = await metaStore.get(id);
  if (meta === null) {
    return { ok: false, code: "NOT_FOUND" };
  }

  // 2. Verify deletion token.
  if (!providedToken) {
    return { ok: false, code: "UNAUTHORIZED" };
  }

  const valid = await verifyDeletionToken(
    providedToken,
    meta.deletion_token_hash
  );
  if (!valid) {
    return { ok: false, code: "UNAUTHORIZED" };
  }

  // 3. Delete blob and metadata concurrently.
  await Promise.all([
    blobStore.delete(meta.blob_key),
    metaStore.delete(id),
  ]);

  return { ok: true };
}
