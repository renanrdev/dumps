/**
 * dumps CLI (@renanrdev/dumps)
 *
 * Usage:
 *   echo "hello" | dumps
 *   cat file.log | dumps --ttl=1h --redact=block
 *   dumps get k3x9Qz7m2P
 *   dumps delete k3x9Qz7m2P
 *   dumps config set url https://self-hosted.example.com
 */

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://dumps.sh";
const CONFIG_DIR = join(homedir(), ".dumps");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const TOKENS_FILE = join(CONFIG_DIR, "tokens.json");

const VALID_TTL = ["10m", "1h", "1d", "7d", "30d"] as const;
const VALID_REDACT = ["warn", "mask", "block"] as const;

type TTLOption = (typeof VALID_TTL)[number];
type RedactOption = (typeof VALID_REDACT)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Config {
  url: string;
}

interface TokenStore {
  [pasteId: string]: {
    token: string;
    url: string;
    saved_at: string;
  };
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

async function ensureConfigDir(): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    // Restrict the directory to owner only — tokens are sensitive.
    await chmod(CONFIG_DIR, 0o700);
  } catch {
    // Already exists or no permission — let subsequent reads/writes surface the real error.
  }
}

async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "url" in parsed &&
      typeof (parsed as Record<string, unknown>)["url"] === "string"
    ) {
      return { url: (parsed as { url: string }).url };
    }
  } catch {
    // File absent or malformed — use defaults.
  }
  return { url: DEFAULT_API_URL };
}

async function writeConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Token store
// ---------------------------------------------------------------------------

async function readTokenStore(): Promise<TokenStore> {
  try {
    const raw = await readFile(TOKENS_FILE, "utf8");
    return JSON.parse(raw) as TokenStore;
  } catch {
    return {};
  }
}

async function saveToken(id: string, token: string, url: string): Promise<void> {
  await ensureConfigDir();
  const store = await readTokenStore();
  store[id] = { token, url, saved_at: new Date().toISOString() };

  // Write atomically: write then chmod.
  await writeFile(TOKENS_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
  // Tokens file must be owner-read-only — contains deletion tokens.
  await chmod(TOKENS_FILE, 0o600);
}

async function getStoredToken(id: string): Promise<string | undefined> {
  const store = await readTokenStore();
  return store[id]?.token;
}

async function removeToken(id: string): Promise<void> {
  const store = await readTokenStore();
  if (id in store) {
    const { [id]: _removed, ...rest } = store;
    await writeFile(TOKENS_FILE, JSON.stringify(rest, null, 2) + "\n", "utf8");
    await chmod(TOKENS_FILE, 0o600);
  }
}

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

async function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    process.stdin.on("error", (err) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Arg parsing — manual, no dependencies
// ---------------------------------------------------------------------------

interface ParsedArgs {
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

function parseArgs(argv: string[]): ParsedArgs {
  // Strip node + script path when running via ts-node / node directly.
  const args = argv.slice(2);

  if (args.length === 0) {
    // No args: we'll check stdin below.
    return { command: "upload" };
  }

  const first = args[0];

  // Subcommands.
  if (first === "get" || first === "fetch") {
    const pasteId = args[1];
    if (!pasteId) die("Usage: dumps get <paste-id>");
    return { command: "get", pasteId };
  }

  if (first === "delete" || first === "rm") {
    const pasteId = args[1];
    if (!pasteId) die("Usage: dumps delete <paste-id> [--token=<del_token>]");
    const token = extractFlag(args, "--token");
    const result: ParsedArgs = { command: "delete", pasteId };
    if (token !== null) result.token = token;
    return result;
  }

  if (first === "config") {
    const action = args[1];
    if (action !== "set" && action !== "get") {
      die("Usage: dumps config set <key> <value>\n       dumps config get <key>");
    }
    const configKey = args[2];
    if (!configKey) die("Usage: dumps config set <key> <value>");
    const configValue = action === "set" ? args[3] : undefined;
    if (action === "set" && !configValue) die("Usage: dumps config set <key> <value>");
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
      die(`Invalid --ttl value "${rawTtl}". Valid: ${VALID_TTL.join(", ")}`);
    }
    parsed.ttl = rawTtl as TTLOption;
  }

  const rawRedact = extractFlag(args, "--redact") ?? extractFlag(args, "-redact");
  if (rawRedact) {
    if (!(VALID_REDACT as readonly string[]).includes(rawRedact)) {
      die(`Invalid --redact value "${rawRedact}". Valid: ${VALID_REDACT.join(", ")}`);
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

/**
 * Extract a flag value from an args array.
 * Handles both "--flag=value" and "--flag value" forms.
 */
function extractFlag(args: string[], flag: string): string | null {
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

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function die(message: string, code = 1): never {
  process.stderr.write(message + "\n");
  process.exit(code);
}

function stderr(message: string): void {
  process.stderr.write(message + "\n");
}

function stdout(message: string): void {
  process.stdout.write(message + "\n");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdUpload(parsed: ParsedArgs, apiUrl: string): Promise<void> {
  const isTTY = process.stdin.isTTY;

  if (isTTY) {
    // Interactive terminal: read multi-line input until Ctrl+D.
    stderr("Reading from stdin (Ctrl+D to finish, Ctrl+C to abort)...");
  }

  let content: Buffer;
  try {
    content = await readStdin();
  } catch (err) {
    die(`Failed to read stdin: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (content.length === 0) {
    die("Error: stdin is empty. Pipe some content to dumps.\n\nExample:\n  echo 'hello' | dumps\n  cat file.log | dumps --ttl=1h");
  }

  // Build URL.
  const url = new URL(apiUrl);
  if (parsed.ttl) url.searchParams.set("ttl", parsed.ttl);
  if (parsed.redact) url.searchParams.set("redact", parsed.redact);
  if (parsed.burn) url.searchParams.set("burn", "1");
  if (parsed.lang) url.searchParams.set("lang", parsed.lang);

  // POST request.
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      body: content,
      headers: {
        "Content-Type": "application/octet-stream",
        // Always request plain-text response — we don't rely on User-Agent sniffing.
        "X-Dumps-Plain": "1",
        "User-Agent": `dumps-cli/${cliVersion()}`,
      },
    });
  } catch (err) {
    die(
      `Network error connecting to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}\n` +
      `Tip: check your connection or run: dumps config set url https://your-host.example.com`
    );
  }

  // Handle error status codes.
  if (response.status === 413) {
    die("Error: content too large (max 1 MB).");
  }

  if (response.status === 422) {
    const body = await response.text();
    die(`Error: secrets detected and blocked.\n${body.trim()}`);
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After") ?? "60";
    die(`Error: rate limit exceeded. Retry after ${retryAfter}s.`);
  }

  if (!response.ok) {
    const body = await response.text();
    die(`Error: server returned ${response.status}.\n${body.trim()}`);
  }

  // Parse response — we requested X-Dumps-Plain:1, so response is text/plain.
  const pasteId = response.headers.get("X-Paste-ID");
  const deletionToken = response.headers.get("X-Deletion-Token");
  const redactionApplied = response.headers.get("X-Redaction-Applied") === "true";
  const redactionTypes = response.headers.get("X-Redaction-Types");

  const body = await response.text();
  // First line is the URL.
  const pasteUrl = body.split("\n")[0]?.trim() ?? "";

  if (!pasteUrl || !pasteUrl.startsWith("http")) {
    die(`Error: unexpected response from server:\n${body}`);
  }

  // Save deletion token for later use.
  if (pasteId && deletionToken) {
    try {
      await saveToken(pasteId, deletionToken, pasteUrl);
    } catch {
      // Non-fatal: token store write failure should not abort the upload.
      stderr(`Warning: could not save deletion token to ${TOKENS_FILE}`);
    }
  }

  // Print URL to stdout — pipeabel, e.g.: URL=$(cat file | dumps)
  stdout(pasteUrl);

  // Print status info to stderr — does not pollute stdout capture.
  if (redactionApplied && redactionTypes) {
    stderr(`Redacted: ${redactionTypes}`);
  }

  if (parsed.burn) {
    stderr("Burn-after-read: paste will be destroyed after first view.");
  }

  if (deletionToken && pasteId) {
    stderr(`Deletion token saved to ${TOKENS_FILE} (id: ${pasteId})`);
  } else if (deletionToken) {
    stderr(`Deletion token: ${deletionToken}`);
  }
}

async function cmdGet(pasteId: string, apiUrl: string): Promise<void> {
  const url = `${apiUrl.replace(/\/$/, "")}/raw/${pasteId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": `dumps-cli/${cliVersion()}` },
    });
  } catch (err) {
    die(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 404) {
    die(`Error: paste "${pasteId}" not found or expired.`);
  }

  if (!response.ok) {
    die(`Error: server returned ${response.status}.`);
  }

  // Stream content directly to stdout.
  const content = await response.arrayBuffer();
  process.stdout.write(Buffer.from(content));
}

async function cmdDelete(
  pasteId: string,
  tokenFlag: string | undefined,
  apiUrl: string
): Promise<void> {
  // Resolve deletion token: explicit flag > stored token > env var.
  let token = tokenFlag;

  if (!token) {
    token = process.env["DUMPS_TOKEN"];
  }

  if (!token) {
    token = await getStoredToken(pasteId);
    if (token) {
      stderr(`Using stored token for ${pasteId}`);
    }
  }

  if (!token) {
    die(
      `Error: no deletion token found for "${pasteId}".\n` +
      `Provide one with --token=del_xxx or set DUMPS_TOKEN env var.\n` +
      `Tokens are auto-saved to ${TOKENS_FILE} when you create a paste.`
    );
  }

  const url = `${apiUrl.replace(/\/$/, "")}/${pasteId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-Deletion-Token": token,
        "User-Agent": `dumps-cli/${cliVersion()}`,
      },
    });
  } catch (err) {
    die(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 403) {
    die(`Error: invalid deletion token for "${pasteId}".`);
  }

  if (response.status === 204) {
    // Clean up from local token store.
    try {
      await removeToken(pasteId);
    } catch {
      // Non-fatal.
    }
    stderr(`Deleted: ${pasteId}`);
    return;
  }

  die(`Error: server returned ${response.status}.`);
}

async function cmdConfig(
  action: "set" | "get",
  key: string,
  value: string | undefined
): Promise<void> {
  const ALLOWED_KEYS = ["url"] as const;
  type ConfigKey = (typeof ALLOWED_KEYS)[number];

  if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
    die(`Unknown config key "${key}". Allowed keys: ${ALLOWED_KEYS.join(", ")}`);
  }

  const configKey = key as ConfigKey;

  if (action === "get") {
    const config = await readConfig();
    stdout(`${configKey}=${config[configKey]}`);
    return;
  }

  // set
  if (value === undefined) die(`Missing value for config key "${key}".`);

  if (configKey === "url") {
    try {
      new URL(value); // Validate it's a real URL.
    } catch {
      die(`Invalid URL: "${value}". Example: https://self-hosted.example.com`);
    }
  }

  const config = await readConfig();
  config[configKey] = value;
  await writeConfig(config);
  stderr(`Config updated: ${configKey}=${value}`);
}

function cmdHelp(): void {
  stdout(`
dumps — CLI for dumps.sh

USAGE
  <stdin> | dumps [flags]          Upload content from stdin
  dumps get <id>                   Fetch paste content to stdout
  dumps delete <id> [--token=...] Delete a paste
  dumps config set <key> <value>  Set configuration
  dumps config get <key>          Get configuration

UPLOAD FLAGS
  --ttl=10m|1h|1d|7d|30d   Expiry (default: 1d)
  --redact=warn|mask|block  Secret redaction mode (default: mask)
  --burn                    Destroy after first read
  --lang=<hint>             Language hint for syntax highlight

CONFIG KEYS
  url   API endpoint (default: https://dumps.sh)

ENVIRONMENT
  DUMPS_TOKEN   Deletion token used by \`dumps delete\` when not in token store

EXAMPLES
  echo "hello world" | dumps
  cat error.log | dumps --ttl=1h --redact=block
  kubectl describe pod x | dumps --ttl=1h --lang=yaml
  echo "$DB_PASSWORD" | dumps --burn

  # Capture URL
  URL=$(cat file.log | dumps)
  echo "Shared at $URL"

  # Read paste
  dumps get k3x9Qz7m2P
  dumps get k3x9Qz7m2P > out.txt

  # Delete paste (token auto-saved on upload)
  dumps delete k3x9Qz7m2P

  # Self-hosted instance
  dumps config set url https://dumps.example.com
  echo "hello" | dumps

TOKEN STORAGE
  Deletion tokens are saved automatically to ~/.dumps/tokens.json (chmod 600).
  Use \`dumps delete <id>\` without --token to use the stored token.
`.trimStart());
}

function cliVersion(): string {
  // Injected by tsup at build time via define. Falls back gracefully.
  return (
    (typeof __CLI_VERSION__ !== "undefined"
      ? (__CLI_VERSION__ as string)
      : undefined) ?? "0.0.0"
  );
}

function cmdVersion(): void {
  stdout(`dumps ${cliVersion()}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const config = await readConfig();
  const apiUrl = config.url;

  switch (parsed.command) {
    case "help":
      cmdHelp();
      break;

    case "version":
      cmdVersion();
      break;

    case "upload":
      await cmdUpload(parsed, apiUrl);
      break;

    case "get": {
      if (!parsed.pasteId) die("Usage: dumps get <paste-id>");
      await cmdGet(parsed.pasteId, apiUrl);
      break;
    }

    case "delete": {
      if (!parsed.pasteId) die("Usage: dumps delete <paste-id>");
      await cmdDelete(parsed.pasteId, parsed.token, apiUrl);
      break;
    }

    case "config": {
      if (!parsed.configAction || !parsed.configKey) {
        die("Usage: dumps config set <key> <value>");
      }
      await cmdConfig(parsed.configAction, parsed.configKey, parsed.configValue);
      break;
    }

    default:
      die("Unknown command. Run `dumps --help` for usage.");
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Unexpected error: ${message}\n`);
  process.exit(1);
});

// Suppress the TypeScript "cannot find name" error for the injected constant.
declare const __CLI_VERSION__: string | undefined;
