// handlers/delete.ts — DELETE /{id}

import { deletePaste } from "../application/delete_paste.js";
import { R2BlobStore } from "../infrastructure/blob_store.js";
import { KVMetadataStore } from "../infrastructure/meta_store.js";
import { securityHeaders } from "./shared.js";
import type { Env } from "../index.js";

export async function handleDelete(
  req: Request,
  env: Env,
  id: string
): Promise<Response> {
  const token = req.headers.get("X-Deletion-Token");

  const blobStore = new R2BlobStore(env.PASTE_BUCKET);
  const metaStore = new KVMetadataStore(env.PASTE_META);

  const outcome = await deletePaste(id, token, blobStore, metaStore);

  if (!outcome.ok) {
    // Always return 403 regardless of whether the ID exists, to prevent
    // paste existence enumeration via the difference between 403 and 404.
    return new Response("Invalid or missing X-Deletion-Token header.\n", {
      status: 403,
      headers: {
        ...securityHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(null, {
    status: 204,
    headers: { ...securityHeaders() },
  });
}
