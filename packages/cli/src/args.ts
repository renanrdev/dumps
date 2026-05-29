/**
 * args.ts — pure argument parsing for the dumps CLI.
 *
 * No I/O and no process control: `parseArgs` throws `UsageError` on bad input
 * instead of calling `process.exit`, so it can be unit-tested in isolation.
 * The entry point (cli.ts) catches `UsageError` and turns it into a stderr
 * message + exit(1).
 */

export const VALID_TTL = ["10m", "1h", "1d", "7d", "30d"] as const;
export const VALID_REDACT = ["warn", "mask", "block"] as const;

export type TTLOption = (typeof VALID_TTL)[number];
export type RedactOption = (typeof VALID_REDACT)[number];

export interface ParsedArgs {
  command: "upload" | "get" | "delete" | "config" | "help" | "version";
  // upload flags
  ttl?: TTLOption;
  redact?: RedactOption;
  burn?: boolean;
  lang?: string;
  // get/delete
  pasteId?: string;
  // delete
  token?: string;
  // config sub-command
  configAction?: "set" | "get";
  configKey?: string;
  configValue?: string;
}

/** Thrown on a usage error. cli.ts converts this into a stderr message + exit(1). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Extract a flag value from an args array.
 * Handles both "--flag=value" and "--flag value" forms.
 */
export function extractFlag(args: string[], flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    // --flag=value form
    if (arg.startsWith(flag + "=")) {
      return arg.slice(flag.length + 1);
    }

    // --flag value form
    if (arg === flag) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        return next;
      }
    }
  }
  return null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  // Strip node + script path when running via ts-node / node directly.
  const args = argv.slice(2);

  if (args.length === 0) {
    // No args: caller checks stdin.
    return { command: "upload" };
  }

  const first = args[0];

  // Subcommands.
  if (first === "get" || first === "fetch") {
    const pasteId = args[1];
    if (!pasteId) throw new UsageError("Usage: dumps get <paste-id>");
    return { command: "get", pasteId };
  }

  if (first === "delete" || first === "rm") {
    const pasteId = args[1];
    if (!pasteId) throw new UsageError("Usage: dumps delete <paste-id> [--token=<del_token>]");
    const token = extractFlag(args, "--token");
    const result: ParsedArgs = { command: "delete", pasteId };
    if (token !== null) result.token = token;
    return result;
  }

  if (first === "config") {
    const action = args[1];
    if (action !== "set" && action !== "get") {
      throw new UsageError("Usage: dumps config set <key> <value>\n       dumps config get <key>");
    }
    const configKey = args[2];
    if (!configKey) throw new UsageError("Usage: dumps config set <key> <value>");
    const configValue = action === "set" ? args[3] : undefined;
    if (action === "set" && !configValue) throw new UsageError("Usage: dumps config set <key> <value>");
    const result: ParsedArgs = { command: "config", configAction: action, configKey };
    if (configValue !== undefined) result.configValue = configValue;
    return result;
  }

  if (first === "--help" || first === "-h" || first === "help") {
    return { command: "help" };
  }

  if (first === "--version" || first === "-v" || first === "version") {
    return { command: "version" };
  }

  // Upload flags — no subcommand, treat remaining args as flags.
  const parsed: ParsedArgs = { command: "upload" };

  const rawTtl = extractFlag(args, "--ttl") ?? extractFlag(args, "-ttl");
  if (rawTtl) {
    if (!(VALID_TTL as readonly string[]).includes(rawTtl)) {
      throw new UsageError(`Invalid --ttl value "${rawTtl}". Valid: ${VALID_TTL.join(", ")}`);
    }
    parsed.ttl = rawTtl as TTLOption;
  }

  const rawRedact = extractFlag(args, "--redact") ?? extractFlag(args, "-redact");
  if (rawRedact) {
    if (!(VALID_REDACT as readonly string[]).includes(rawRedact)) {
      throw new UsageError(`Invalid --redact value "${rawRedact}". Valid: ${VALID_REDACT.join(", ")}`);
    }
    parsed.redact = rawRedact as RedactOption;
  }

  if (args.includes("--burn") || args.includes("-burn")) {
    parsed.burn = true;
  }

  const rawLang = extractFlag(args, "--lang") ?? extractFlag(args, "-lang");
  if (rawLang) {
    parsed.lang = rawLang;
  }

  return parsed;
}
