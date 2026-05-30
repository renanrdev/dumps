// handlers/get.ts — GET /{id} (HTML view) and GET /raw/{id} (raw bytes).

import { getPaste } from "../application/get_paste.js";
import { R2BlobStore } from "../infrastructure/blob_store.js";
import { KVMetadataStore } from "../infrastructure/meta_store.js";
import { securityHeaders, htmlSecurityHeaders } from "./shared.js";
import type { PasteMetadata } from "../domain/paste.js";
import type { Env } from "../index.js";

// ---------------------------------------------------------------------------
// Raw endpoint — serves bytes with strict content type
// ---------------------------------------------------------------------------

export async function handleGetRaw(
  req: Request,
  env: Env,
  id: string
): Promise<Response> {
  const blobStore = new R2BlobStore(env.PASTE_BUCKET);
  const metaStore = new KVMetadataStore(env.PASTE_META);

  const outcome = await getPaste(id, blobStore, metaStore);

  if (!outcome.ok) {
    return new Response("Paste not found or expired.\n", {
      status: 404,
      headers: {
        ...securityHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const { meta, content } = outcome.result;

  // Raw content MUST always be text/plain — never text/html.
  // Content-Disposition: inline keeps it in-browser but prevents HTML parsing.
  return new Response(content.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      ...securityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, no-cache",
      "X-Paste-Lang": meta.detected_lang,
      "X-Paste-Size": String(meta.size),
    },
  });
}

// ---------------------------------------------------------------------------
// HTML view endpoint
// ---------------------------------------------------------------------------

export async function handleGetView(
  req: Request,
  env: Env,
  id: string
): Promise<Response> {
  const blobStore = new R2BlobStore(env.PASTE_BUCKET);
  const metaStore = new KVMetadataStore(env.PASTE_META);

  const outcome = await getPaste(id, blobStore, metaStore);

  if (!outcome.ok) {
    return notFoundPage();
  }

  const { meta, content } = outcome.result;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(content);

  const expiresIn = formatRelativeTime(meta.expires_at);
  const html = renderViewPage(id, text, meta, expiresIn);

  return new Response(html, {
    status: 200,
    headers: {
      ...htmlSecurityHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

function notFoundPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not Found — dumps.sh</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'SF Mono',ui-monospace,monospace;background:#111;color:#d4d4d4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
  .code{font-size:5rem;font-weight:700;color:#1e1e1e;letter-spacing:-2px;line-height:1}
  .code span{color:#c0392b}
  .msg{color:#555;font-size:0.85rem}
  a{display:inline-flex;align-items:center;gap:8px;color:#c0392b;text-decoration:none;font-size:0.8rem;border:1px solid #2a2a2a;padding:4px 12px;border-radius:4px;transition:border-color .15s}
  a:hover{border-color:#c0392b}
  a img{height:16px;width:auto;opacity:.7}
</style>
</head>
<body>
<div class="box">
  <div class="code"><span>4</span>0<span>4</span></div>
  <div class="msg">paste not found or has expired</div>
  <a href="/"><img src="/icon.png" alt="">dumps.sh</a>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      ...htmlSecurityHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function renderViewPage(
  id: string,
  text: string,
  meta: PasteMetadata,
  expiresIn: string
): string {
  const escapedContent = escapeHtml(text);
  const lineCount = text.split("\n").length;
  const sizeDisplay = formatBytes(meta.size);
  const rawUrl = `/raw/${id}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(id)} — dumps.sh</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'SF Mono',ui-monospace,monospace;background:#111;color:#d4d4d4;margin:0;padding:0;font-size:13px}
  header{background:#151515;border-bottom:1px solid #1e1e1e;padding:9px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;position:sticky;top:0;z-index:10}
  .logo{color:#fff;font-weight:600;font-size:0.9rem;text-decoration:none;letter-spacing:.3px;flex-shrink:0;display:flex;align-items:center;gap:10px}
  .logo img{height:22px;width:auto}
  .logo em{color:#c0392b;font-style:normal}
  .meta{color:#444;font-size:0.72rem;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .badge{background:#181818;border:1px solid #222;border-radius:3px;padding:1px 6px;font-size:0.68rem}
  .badge.lang{color:#c0392b;border-color:#2a1212}
  .badge.warn{color:#c0392b;border-color:#c0392b33}
  .actions{margin-left:auto;display:flex;gap:6px;flex-shrink:0}
  .btn{background:transparent;border:1px solid #222;color:#555;padding:3px 10px;border-radius:3px;font-family:inherit;font-size:0.72rem;cursor:pointer;text-decoration:none;display:inline-block;transition:border-color .15s,color .15s}
  .btn:hover{border-color:#c0392b;color:#d4d4d4}
  .content-area{overflow:auto;max-height:calc(100vh - 46px)}
  pre{margin:0;padding:12px 0;tab-size:4}
  .line{display:flex;min-height:1.5em}
  .line:hover{background:#161616}
  .line:target{background:#1d0e0e}
  .line-numbers{display:inline-block;min-width:46px;text-align:right;padding:0 14px;color:#484848;user-select:none;position:sticky;left:0;background:#111;flex-shrink:0}
  .line-content{padding:0 20px 0 6px;white-space:pre;flex:1;min-width:0;color:#c8c8c8}
  .redacted{color:#c0392b;background:#1c0a0a;border-radius:2px;padding:0 3px}
  footer{position:fixed;bottom:0;right:0;padding:5px 14px;font-size:0.62rem;color:#525252;background:#111;letter-spacing:.5px}
  #error-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:100;align-items:center;justify-content:center}
  #error-modal.open{display:flex}
  #error-modal .box{background:#171717;border:1px solid #2a2a2a;border-radius:6px;padding:24px;max-width:400px;width:90%;display:flex;flex-direction:column;gap:14px}
  #error-modal .box h3{margin:0;font-size:0.85rem;color:#c0392b;text-transform:uppercase;letter-spacing:.5px}
  #error-modal .box p{margin:0;color:#555;font-size:0.8rem;word-break:break-word}
  #error-modal .box button{align-self:flex-end;background:transparent;border:1px solid #2a2a2a;color:#555;border-radius:3px;padding:4px 14px;cursor:pointer;font-family:inherit;font-size:0.75rem;transition:border-color .15s,color .15s}
  #error-modal .box button:hover{border-color:#c0392b;color:#d4d4d4}
</style>
</head>
<body>
<header>
  <a class="logo" href="/"><img src="/icon.png" alt="dumps.sh" width="46" height="22"><em>dumps</em>.sh</a>
  <div class="meta">
    <span class="badge lang">${escapeHtml(meta.detected_lang)}</span>
    <span>${lineCount} lines</span>
    <span>${sizeDisplay}</span>
    <span>expires ${escapeHtml(expiresIn)}</span>
    ${meta.redaction_applied ? `<span class="badge warn">redacted: ${escapeHtml(meta.redaction_types.join(", "))}</span>` : ""}
  </div>
  <div class="actions">
    <a class="btn" href="${escapeHtml(rawUrl)}" target="_blank">raw</a>
    <button class="btn" onclick="copyRaw()">copy</button>
  </div>
</header>
<div class="content-area">
<pre id="code">${renderLines(escapedContent)}</pre>
</div>
<footer>dumps.sh · ephemeral by default</footer>
<div id="error-modal" role="dialog" aria-modal="true">
  <div class="box">
    <h3>Copy failed</h3>
    <p id="error-msg"></p>
    <button onclick="closeError()">Dismiss</button>
  </div>
</div>
<script>
const RAW_URL = ${JSON.stringify(rawUrl)};
async function copyRaw() {
  try {
    const r = await fetch(RAW_URL);
    const t = await r.text();
    await navigator.clipboard.writeText(t);
    const btn = document.querySelector('[onclick="copyRaw()"]');
    const orig = btn.textContent;
    btn.textContent = 'copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch(e) { showError(e.message); }
}
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('error-modal').classList.add('open');
}
function closeError() {
  document.getElementById('error-modal').classList.remove('open');
}
document.getElementById('error-modal').addEventListener('click', function(e) {
  if (e.target === this) closeError();
});
// Highlight anchor-linked line on load
function highlightAnchor() {
  const hash = location.hash;
  if (!hash) return;
  const el = document.querySelector(hash);
  if (el) { el.style.background = '#2d2f31'; el.scrollIntoView({block:'center'}); }
}
window.addEventListener('load', highlightAnchor);
window.addEventListener('hashchange', highlightAnchor);
</script>
</body>
</html>`;
}

function renderLines(escapedText: string): string {
  const lines = escapedText.split("\n");
  return lines
    .map((line, i) => {
      const n = i + 1;
      // Highlight ‹REDACTED:...› tags in the rendered output.
      const highlighted = line.replace(
        /‹REDACTED:[^›]+›/g,
        (m) => `<span class="redacted">${m}</span>`
      );
      return `<span class="line" id="L${n}"><span class="line-numbers">${n}</span><span class="line-content">${highlighted}</span></span>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;

  if (diff <= 0) return "now";
  if (diff < 60) return `in ${diff}s`;
  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}
