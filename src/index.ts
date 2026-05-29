// src/index.ts — Cloudflare Workers entry point.
// Defines the Env interface, exports the RateLimiterDO class, and routes requests.

export { RateLimiterDO } from "./infrastructure/rate_limiter.js";
import type { RateLimiterDO } from "./infrastructure/rate_limiter.js";

import { handleCreate } from "./handlers/create.js";
import { handleGetView, handleGetRaw } from "./handlers/get.js";
import { handleDelete } from "./handlers/delete.js";
import { handleHealth } from "./handlers/health.js";
import { securityHeaders } from "./handlers/shared.js";

// ---------------------------------------------------------------------------
// Environment bindings interface — must match wrangler.toml exactly.
// ---------------------------------------------------------------------------

export interface Env {
  PASTE_BUCKET: R2Bucket;
  PASTE_META: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace<RateLimiterDO>;
  BASE_URL?: string; // Optional override; defaults to request origin.
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname, method } = parseRequest(url, req);

    try {
      // GET /healthz
      if (method === "GET" && pathname === "/healthz") {
        return handleHealth();
      }

      // POST / — create paste
      if (method === "POST" && pathname === "/") {
        return handleCreate(req, env);
      }

      // GET /raw/{id} — raw bytes
      const rawMatch = pathname.match(/^\/raw\/([A-Za-z0-9]{5,20})$/);
      if (method === "GET" && rawMatch && rawMatch[1]) {
        return handleGetRaw(req, env, rawMatch[1]);
      }

      // GET /{id} — HTML view
      const viewMatch = pathname.match(/^\/([A-Za-z0-9]{5,20})$/);
      if (method === "GET" && viewMatch && viewMatch[1]) {
        return handleGetView(req, env, viewMatch[1]);
      }

      // DELETE /{id} — delete paste
      const deleteMatch = pathname.match(/^\/([A-Za-z0-9]{5,20})$/);
      if (method === "DELETE" && deleteMatch && deleteMatch[1]) {
        return handleDelete(req, env, deleteMatch[1]);
      }

      // GET / — landing page
      if (method === "GET" && pathname === "/") {
        return landingPage();
      }

      return new Response("Not Found\n", {
        status: 404,
        headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[dumps.sh] Unhandled error:", message);
      return new Response("Internal Server Error\n", {
        status: 500,
        headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRequest(
  url: URL,
  req: Request
): { pathname: string; method: string } {
  // Normalize trailing slash (except for root).
  let pathname = url.pathname;
  if (pathname !== "/" && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return { pathname, method: req.method.toUpperCase() };
}

function landingPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dumps.sh — pastebin CLI-first</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'SF Mono',ui-monospace,monospace;background:#111;color:#d4d4d4;margin:0;padding:0;min-height:100vh;display:flex;flex-direction:column}
  main{max-width:680px;margin:0 auto;padding:72px 24px 80px;flex:1}
  .logo{font-size:1.4rem;font-weight:700;color:#fff;margin:0 0 8px;letter-spacing:-.5px}
  .logo em{color:#c0392b;font-style:normal}
  .tagline{color:#444;font-size:0.8rem;margin:0 0 56px;line-height:1.6}
  .section{margin-bottom:36px}
  .section-label{font-size:0.65rem;color:#525252;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
  .card{background:#151515;border:1px solid #1e1e1e;border-radius:5px;padding:16px 18px}
  .card+.card{margin-top:8px}
  code{color:#c8c8c8;display:block;font-size:0.8rem;white-space:pre-wrap;word-break:break-all;line-height:1.7}
  .dim{color:#4e4e4e}
  .accent{color:#c0392b}
  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:48px}
  .tag{background:#151515;border:1px solid #1e1e1e;border-radius:3px;padding:2px 8px;font-size:0.68rem;color:#444}
  footer{padding:20px 24px;font-size:0.65rem;color:#525252;border-top:1px solid #1e1e1e;text-align:center;letter-spacing:.3px}
  footer a{color:#525252;text-decoration:none}footer a:hover{color:#c0392b}
</style>
</head>
<body>
<main>
  <h1 class="logo"><em>dumps</em>.sh</h1>
  <p class="tagline">pastebin CLI-first · no account · ephemeral by default · secrets masked</p>

  <div class="section">
    <div class="section-label">curl</div>
    <div class="card">
      <code>cat error.log | curl --data-binary @- https://dumps.sh</code>
      <code class="dim"># → https://dumps.sh/k3x9Qz7m2P</code>
    </div>
    <div class="card">
      <code>kubectl logs pod/x | curl --data-binary @- <span class="accent">"https://dumps.sh?ttl=1h"</span></code>
    </div>
    <div class="card">
      <code>echo "$SECRET" | curl --data-binary @- <span class="accent">"https://dumps.sh?burn=1"</span></code>
      <code class="dim"># shown verbatim, then destroyed after first read</code>
    </div>
    <div class="card">
      <code>make test 2>&amp;1 | curl --data-binary @- <span class="accent">"https://dumps.sh?redact=block"</span></code>
      <code class="dim"># 422 if secrets detected</code>
    </div>
    <div class="card">
      <code><span class="dim"># read raw content</span></code>
      <code>curl https://dumps.sh/raw/k3x9Qz7m2P</code>
    </div>
    <div class="card">
      <code><span class="dim"># delete (token returned in X-Deletion-Token header on create)</span></code>
      <code>curl -X DELETE -H <span class="accent">"X-Deletion-Token: del_xxx"</span> https://dumps.sh/k3x9Qz7m2P</code>
    </div>
  </div>

  <div class="section">
    <div class="section-label">npm cli — @renanrdev/dumps</div>
    <div class="card">
      <code>npm i -g @renanrdev/dumps</code>
    </div>
    <div class="card">
      <code>cat error.log | dumps</code>
      <code class="dim"># → https://dumps.sh/k3x9Qz7m2P</code>
    </div>
    <div class="card">
      <code>cat error.log | dumps <span class="accent">--ttl=1h --redact=block</span></code>
    </div>
    <div class="card">
      <code>echo "$SECRET" | dumps <span class="accent">--burn</span></code>
      <code class="dim"># shared as-is (not masked), gone after first read</code>
    </div>
    <div class="card">
      <code><span class="dim"># read paste to stdout</span></code>
      <code>dumps get k3x9Qz7m2P</code>
    </div>
    <div class="card">
      <code><span class="dim"># delete (token auto-saved on upload to ~/.dumps/tokens.json)</span></code>
      <code>dumps delete k3x9Qz7m2P</code>
    </div>
  </div>

  <div class="section">
    <div class="section-label">parameters</div>
    <div class="card">
      <code><span class="accent">?ttl</span>=10m|1h|1d|7d|30d   <span class="dim">(default: 1d)</span></code>
      <code><span class="accent">?redact</span>=warn|mask|block  <span class="dim">(default: mask)</span></code>
      <code><span class="accent">?burn</span>=1                  <span class="dim">(verbatim, destroyed after first read)</span></code>
      <code><span class="accent">?lang</span>=yaml|json|...      <span class="dim">(language hint)</span></code>
    </div>
  </div>

  <div class="section">
    <div class="section-label">auto-redaction</div>
    <div class="card">
      <code>echo "AKIAIOSFODNN7EXAMPLE" | curl --data-binary @- https://dumps.sh</code>
      <code class="dim"># stored as ‹REDACTED:aws_access_key_id›</code>
    </div>
  </div>

  <div class="tags">
    <span class="tag">1 MB limit</span>
    <span class="tag">no account</span>
    <span class="tag">secrets masked by default</span>
    <span class="tag">ephemeral</span>
  </div>
</main>
<footer>dumps.sh · ephemeral by default</footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}
