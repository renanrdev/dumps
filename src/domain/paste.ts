// domain/paste.ts — Core domain types. No I/O, no Cloudflare dependencies.

export type RedactionMode = "warn" | "mask" | "block";

export type TTLOption = "10m" | "1h" | "1d" | "7d" | "30d";

export const TTL_SECONDS: Record<TTLOption, number> = {
  "10m": 10 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

export const DEFAULT_TTL: TTLOption = "1d";
export const MAX_ANON_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

export interface PasteMetadata {
  id: string;
  created_at: number; // Unix timestamp seconds
  expires_at: number; // Unix timestamp seconds
  size: number; // bytes
  detected_lang: string;
  blob_key: string;
  encrypted: boolean;
  burn: boolean; // destroy after first read
  redaction_applied: boolean;
  redaction_types: string[];
  deletion_token_hash: string;
}

export interface CreatePasteInput {
  content: Uint8Array;
  ttl: TTLOption;
  redactMode: RedactionMode;
  langHint?: string;
  burn?: boolean;
}

export interface CreatePasteResult {
  id: string;
  url: string;
  deletionToken: string;
  redactionApplied: boolean;
  redactionTypes: string[];
}

/** Parse a raw TTL query param. Returns DEFAULT_TTL if invalid. */
export function parseTTL(raw: string | null): TTLOption {
  if (!raw) return DEFAULT_TTL;
  const valid: TTLOption[] = ["10m", "1h", "1d", "7d", "30d"];
  return valid.includes(raw as TTLOption) ? (raw as TTLOption) : DEFAULT_TTL;
}

/** Parse a raw redaction mode query param. Returns "mask" if invalid. */
export function parseRedactMode(raw: string | null): RedactionMode {
  if (!raw) return "mask";
  const valid: RedactionMode[] = ["warn", "mask", "block"];
  return valid.includes(raw as RedactionMode) ? (raw as RedactionMode) : "mask";
}

/**
 * Resolve the effective redaction mode for a create request.
 *
 * Burn-after-read pastes exist to share a secret exactly once, so masking the
 * secret would defeat their entire purpose. When the caller gives no explicit
 * redaction mode, `burn` implies "warn" (store the content verbatim). An
 * explicit mode always wins — `?burn=1&redact=block` still blocks.
 */
export function resolveRedactMode(
  raw: string | null,
  burn: boolean
): RedactionMode {
  if (raw === null && burn) return "warn";
  return parseRedactMode(raw);
}

/** Detect a rough language hint from content for display purposes. */
export function detectLang(content: string, hint?: string): string {
  // Strip control characters (incl. CR/LF) before using in HTTP headers.
  if (hint) return hint.replace(/[\x00-\x1f\x7f]/g, "").toLowerCase().slice(0, 20);

  const trimmed = content.trimStart();

  // Unambiguous prefixes first.
  if (trimmed.startsWith("{")) return "json";
  if (/^---\s*\n/.test(trimmed)) return "yaml";
  if (/^resource\s+"/.test(trimmed) || /^terraform\s+\{/.test(trimmed)) return "hcl";
  if (/^-----BEGIN /.test(trimmed)) return "pem";
  if (/^diff --git/.test(trimmed) || /^@@\s+-\d+/.test(trimmed)) return "diff";
  if (/^\$ /.test(trimmed) || /^#!\//.test(trimmed)) return "shell";
  // Log/kubectl checks before the generic yaml key-value pattern to avoid
  // misdetecting "Error: ..." or "Name:  pod" as YAML.
  if (/^(Error|Exception|Traceback|panic:|goroutine \d+)/.test(trimmed)) return "log";
  if (/^(Name|Namespace|Labels|Status):\s+/.test(trimmed)) return "kubectl";
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{2}:\d{2}:\d{2}/.test(trimmed)) return "log";
  // Bracket: could be a JSON array or a timestamp log line like [2024-01-15].
  if (trimmed.startsWith("[")) {
    if (/^\[\d{4}-\d{2}-\d{2}|\[\d{2}:\d{2}/.test(trimmed)) return "log";
    return "json";
  }
  // Generic YAML key: value — broad, so it comes last among prefix checks.
  if (/^[a-zA-Z_][a-zA-Z0-9_]*:\s/.test(trimmed)) return "yaml";

  return "text";
}
