// domain/scanner.ts — Secret scanner. Pure functions, no I/O.
// Implements mode: warn | mask | block for the MVP (Fase 0).

export interface SecretMatch {
  type: string;        // human-readable type label, e.g. "aws_access_key_id"
  start: number;       // byte offset in the original string
  end: number;         // exclusive end offset
  value: string;       // the matched secret value (used only internally for masking)
}

export interface ScanResult {
  redacted: string;           // content after masking (same as input when mode=warn)
  matches: SecretMatch[];     // all detected secrets
  types: string[];            // deduplicated list of match types
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

interface Rule {
  type: string;
  /**
   * The regex MUST capture the secret value in group 1.
   * The full match is replaced; only group 1 is labelled in the redaction tag.
   */
  pattern: RegExp;
}

// Build rules once; exported for test introspection.
export const RULES: Rule[] = [
  {
    type: "aws_access_key_id",
    // AKIA followed by exactly 16 uppercase alphanumeric chars
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    type: "aws_secret_access_key",
    // 40-char alphanumeric+/+ string after keywords common in AWS configs
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY|SecretAccessKey)\s*[=:]\s*["']?([A-Za-z0-9/+]{40})["']?/g,
  },
  {
    type: "github_token",
    // GitHub personal access tokens (classic and new formats)
    pattern: /\b(gh[pos]_[A-Za-z0-9]{36,})\b/g,
  },
  {
    type: "github_token",
    // GitHub actions / server-to-server tokens
    pattern: /\b(ghs_[A-Za-z0-9]{36,})\b/g,
  },
  {
    type: "slack_token",
    // Slack bot, app, user, workspace, refresh, and legacy tokens
    pattern: /\b(xox[baprs]-[0-9A-Za-z\-]{10,})\b/g,
  },
  {
    type: "stripe_secret_key",
    pattern: /\b(sk_live_[0-9a-zA-Z]{24,})\b/g,
  },
  {
    type: "jwt",
    // JSON Web Token: three base64url segments starting with "eyJ"
    pattern:
      /\b(eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\b/g,
  },
  {
    type: "pem_private_key",
    // PEM block header — the content until END line is the secret
    pattern: /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g,
  },
  {
    type: "authorization_bearer",
    // Authorization: Bearer <token> header (in logs, configs, etc.)
    pattern: /\b(?:Authorization|authorization)\s*:\s*Bearer\s+([A-Za-z0-9\-._~+/]+=*)\b/g,
  },
  {
    type: "connection_string_password",
    // DSN/URI with embedded credentials: scheme://user:password@host
    // Covers postgres, mysql, mongodb, redis, amqp, etc.
    // NOTE: lowercase-only (no 'i' flag) — the 'i' flag caused O(n²) backtracking
    // because [a-z] would match uppercase letters, letting the greedy scheme
    // quantifier consume the entire remaining input before backtracking.
    // DSN schemes are always lowercase in practice (postgres, mysql, mongodb…).
    // Upper bound {4,200} adds defense-in-depth against remaining backtracking.
    pattern:
      /(?:[a-z][a-z0-9+\-.]*:\/\/[^:/?#\s]+:)([^@\s]{4,200})(?:@)/g,
  },
  {
    type: "generic_password",
    // password= / secret= / token= / api-key= / api_key= assignments
    pattern:
      /\b(?:password|secret|token|passwd|api[-_]key|apikey)\s*[=:]\s*["']?([A-Za-z0-9!@#$%^&*\-_+=/]{8,64})["']?/gi,
  },
];

// ---------------------------------------------------------------------------
// Core scan function
// ---------------------------------------------------------------------------

/**
 * Scan `content` for secrets.
 * - mode "warn"  → returns matches but content is unchanged.
 * - mode "mask"  → replaces each secret with ‹REDACTED:type›.
 * - mode "block" → returns matches but content is unchanged (caller decides).
 */
export function scan(content: string, mode: "warn" | "mask" | "block" = "mask"): ScanResult {
  // Collect all matches across all rules, preserving position info.
  const allMatches: SecretMatch[] = [];

  for (const rule of RULES) {
    // Reset lastIndex for global regexes each call.
    rule.pattern.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(content)) !== null) {
      const fullMatch = m[0];
      const secretValue = m[1] ?? fullMatch;
      const startOfSecret = m.index + fullMatch.indexOf(secretValue);
      allMatches.push({
        type: rule.type,
        start: startOfSecret,
        end: startOfSecret + secretValue.length,
        value: secretValue,
      });
    }
  }

  // Deduplicate overlapping matches (keep first one, discard those inside it).
  const deduped = deduplicateMatches(allMatches);

  const types = [...new Set(deduped.map((m) => m.type))];

  if (mode !== "mask" || deduped.length === 0) {
    return { redacted: content, matches: deduped, types };
  }

  // Build masked string by replacing secrets in reverse order (so offsets stay valid).
  const sorted = [...deduped].sort((a, b) => b.start - a.start);
  let result = content;
  for (const match of sorted) {
    const tag = `‹REDACTED:${match.type}›`; // ‹REDACTED:type›
    result = result.slice(0, match.start) + tag + result.slice(match.end);
  }

  return { redacted: result, matches: deduped, types };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateMatches(matches: SecretMatch[]): SecretMatch[] {
  if (matches.length === 0) return [];

  // Sort by start position, then by length descending (prefer longer match).
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start)
  );

  const result: SecretMatch[] = [];
  let lastEnd = -1;

  for (const m of sorted) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
    // else: overlapping — skip
  }

  return result;
}
