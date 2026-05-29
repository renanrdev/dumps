// handlers/create.ts — POST /

import { parseTTL, parseRedactMode } from "../domain/paste.js";
import { createPaste } from "../application/create_paste.js";
import { checkRateLimit } from "../infrastructure/rate_limiter.js";
import { R2BlobStore } from "../infrastructure/blob_store.js";
import { KVMetadataStore } from "../infrastructure/meta_store.js";
import { securityHeaders } from "./shared.js";
import type { Env } from "../index.js";

/**
 * Heuristic: does the caller prefer a plain-text URL response?
 * True when:
 *   - User-Agent starts with "curl" (the primary CLI UX)
 *   - Accept header contains "text/plain" and NOT "text/html"
 *   - Explicit override header X-Dumps-Plain: 1
 */
function wantsPlainResponse(req: Request): boolean {
  const ua = req.headers.get("User-Agent") ?? "";
  const accept = req.headers.get("Accept") ?? "";
  const override = req.headers.get("X-Dumps-Plain");

  if (override === "1") return true;
  if (ua.toLowerCase().startsWith("curl")) return true;
  if (accept.includes("text/plain") && !accept.includes("text/html"))
    return true;
  return false;
}

export async function handleCreate(
  req: Request,
  env: Env
): Promise<Response> {
  // 1. Rate limiting — per IP using Durable Objects.
  const ip =
    req.headers.get("CF-Connecting-IP") ??
    req.headers.get("X-Forwarded-For") ??
    "unknown";
  const rateCheck = await checkRateLimit(env, ip);
  if (!rateCheck.allowed) {
    return new Response("Rate limit exceeded. Please slow down.\n", {
      status: 429,
      headers: {
        ...securityHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "60",
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  // 2. Read body.
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return new Response("Failed to read request body.\n", {
      status: 400,
      headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // 3. Parse query params.
  const url = new URL(req.url);
  const ttl = parseTTL(url.searchParams.get("ttl"));
  const redactMode = parseRedactMode(url.searchParams.get("redact"));
  const langHintRaw = url.searchParams.get("lang");
  const langHint: string | undefined = langHintRaw !== null ? langHintRaw : undefined;
  const burn = url.searchParams.get("burn") === "1";

  // 4. Determine base URL for the paste URL returned to caller.
  const baseUrl = `${url.protocol}//${url.host}`;

  // 5. Execute use case.
  const blobStore = new R2BlobStore(env.PASTE_BUCKET);
  const metaStore = new KVMetadataStore(env.PASTE_META);

  const pasteInput = langHint !== undefined
    ? { content: new Uint8Array(body), ttl, redactMode, langHint, burn }
    : { content: new Uint8Array(body), ttl, redactMode, burn };

  const outcome = await createPaste(
    pasteInput,
    blobStore,
    metaStore,
    baseUrl
  );

  if (!outcome.ok) {
    const { error } = outcome;

    if (error.code === "TOO_LARGE") {
      return new Response(`Error: ${error.message}\n`, {
        status: 413,
        headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (error.code === "EMPTY_BODY") {
      return new Response(`Error: ${error.message}\n`, {
        status: 400,
        headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (error.code === "SECRETS_BLOCKED") {
      const body = wantsPlainResponse(req)
        ? `Error: ${error.message}\n`
        : JSON.stringify({ error: error.message, details: error.details });
      return new Response(body, {
        status: 422,
        headers: {
          ...securityHeaders(),
          "Content-Type": wantsPlainResponse(req)
            ? "text/plain; charset=utf-8"
            : "application/json",
        },
      });
    }

    return new Response("Internal Server Error\n", {
      status: 500,
      headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const { result } = outcome;
  const plain = wantsPlainResponse(req);

  const responseHeaders: Record<string, string> = {
    ...securityHeaders(),
    "X-Deletion-Token": result.deletionToken,
    "X-Paste-ID": result.id,
    "Cache-Control": "no-store",
  };

  if (result.redactionApplied) {
    responseHeaders["X-Redaction-Applied"] = "true";
    responseHeaders["X-Redaction-Types"] = result.redactionTypes.join(",");
  }

  if (plain) {
    responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
    // URL on its own line — pipeável.
    return new Response(result.url + "\n", { status: 201, headers: responseHeaders });
  }

  // Browser: return JSON.
  responseHeaders["Content-Type"] = "application/json";
  return new Response(
    JSON.stringify({
      id: result.id,
      url: result.url,
      deletion_token: result.deletionToken,
      redaction_applied: result.redactionApplied,
      redaction_types: result.redactionTypes,
    }),
    { status: 201, headers: responseHeaders }
  );
}
