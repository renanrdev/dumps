// application/create_paste.ts — CreatePaste use case.
// Orchestrates: validate → scan → generate ID → store blob → store metadata.

import {
  detectLang,
  MAX_ANON_SIZE_BYTES,
  TTL_SECONDS,
  type CreatePasteInput,
  type CreatePasteResult,
  type PasteMetadata,
} from "../domain/paste.js";
import { scan } from "../domain/scanner.js";
import { generateDeletionToken, generateId } from "../domain/id_generator.js";
import type { BlobStore } from "../infrastructure/blob_store.js";
import type { MetadataStore } from "../infrastructure/meta_store.js";

export interface CreatePasteError {
  code: "TOO_LARGE" | "SECRETS_BLOCKED" | "EMPTY_BODY";
  message: string;
  details?: object;
}

export type CreatePasteOutcome =
  | { ok: true; result: CreatePasteResult }
  | { ok: false; error: CreatePasteError };

export async function createPaste(
  input: CreatePasteInput,
  blobStore: BlobStore,
  metaStore: MetadataStore,
  baseUrl: string
): Promise<CreatePasteOutcome> {
  // 1. Size check
  if (input.content.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_BODY", message: "Request body is empty." },
    };
  }
  if (input.content.length > MAX_ANON_SIZE_BYTES) {
    return {
      ok: false,
      error: {
        code: "TOO_LARGE",
        message: `Paste exceeds the 1 MB limit (got ${input.content.length} bytes).`,
      },
    };
  }

  // 2. Decode to string for scanning and language detection.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const contentStr = decoder.decode(input.content);

  // 3. Secret scan
  const scanResult = scan(contentStr, input.redactMode);

  if (input.redactMode === "block" && scanResult.matches.length > 0) {
    return {
      ok: false,
      error: {
        code: "SECRETS_BLOCKED",
        message: `Blocked: ${scanResult.matches.length} secret(s) detected. Types: ${scanResult.types.join(", ")}.`,
        details: {
          count: scanResult.matches.length,
          types: scanResult.types,
          // Never include the matched values in the error — only positions.
          locations: scanResult.matches.map((m) => ({
            type: m.type,
            start: m.start,
            end: m.end,
          })),
        },
      },
    };
  }

  // 4. Determine final content (masked or original).
  const finalContent =
    input.redactMode === "mask" && scanResult.matches.length > 0
      ? scanResult.redacted
      : contentStr;

  const encoder = new TextEncoder();
  const finalBytes = encoder.encode(finalContent);

  // 5. Generate paste ID (retry on the extremely rare collision).
  let id: string;
  let attempts = 0;
  do {
    id = generateId();
    attempts++;
    if (attempts > 5) {
      // Defensive ceiling — should never happen in practice.
      break;
    }
    const existing = await metaStore.get(id);
    if (existing === null) break;
  } while (true);

  // 6. Generate deletion token.
  const { token: deletionToken, hash: deletionTokenHash } =
    await generateDeletionToken();

  // 7. Build metadata.
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = TTL_SECONDS[input.ttl];
  const blobKey = `blob/${id}`;
  const lang = detectLang(finalContent, input.langHint);

  const meta: PasteMetadata = {
    id,
    created_at: now,
    expires_at: now + ttlSeconds,
    size: finalBytes.length,
    detected_lang: lang,
    blob_key: blobKey,
    encrypted: false,
    burn: input.burn ?? false,
    redaction_applied: scanResult.matches.length > 0,
    redaction_types: scanResult.types,
    deletion_token_hash: deletionTokenHash,
  };

  // 8. Store blob first, then metadata (order matters for consistency:
  //    if metadata write fails, the orphaned blob will be cleaned by R2 lifecycle).
  await blobStore.put(blobKey, finalBytes);
  await metaStore.put(meta, ttlSeconds);

  return {
    ok: true,
    result: {
      id,
      url: `${baseUrl}/${id}`,
      deletionToken,
      redactionApplied: meta.redaction_applied,
      redactionTypes: meta.redaction_types,
    },
  };
}
