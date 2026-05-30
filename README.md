# dumps.sh

<img src="dumps_mark.png" alt="dumps.sh" height="48">

**CLI-first pastebin for DevOps.** From the terminal to a link — format preserved, secrets not leaked.

```bash
cat error.log | curl --data-binary @- https://dumps.sh
# → https://dumps.sh/k3x9Qz7m2P
```

- 📋 **Pipe straight** from the terminal — `curl` or the `dumps` CLI
- 🔒 **Secrets masked** by default (AWS, GitHub, JWT, Stripe…)
- ⏳ **Ephemeral** — expires on its own; `--burn` destroys after the first read
- 🧾 **Format preserved** byte for byte, with a pipeable raw URL for CI

## Install (CLI)

```bash
npm install -g @renanrdev/dumps
```

> Don't want to install anything? Use `curl --data-binary @- https://dumps.sh`.

## Usage

```bash
# Upload — the URL goes to stdout (pipeable)
cat error.log | dumps

# With options
kubectl describe pod x | dumps --ttl=1h --lang=yaml
make test 2>&1        | dumps --redact=block   # rejects if a secret is found
echo "$DB_PASSWORD"   | dumps --burn           # one-time secret, shared verbatim

# Read and delete (token saved automatically on create)
dumps get <id>
dumps delete <id>
```

| Flag | Values | Default |
|---|---|---|
| `--ttl` | `10m` `1h` `1d` `7d` `30d` | `1d` |
| `--redact` | `warn` `mask` `block` | `mask` |
| `--burn` | destroy after first read | — |
| `--lang` | language hint | auto |

The same options work as query params with `curl`: `...?ttl=1h&redact=block&burn=1`.

## Security

- Known secrets are masked **server-side** before anything is persisted (use `--redact=block` to reject instead).
- IDs are non-enumerable (CSPRNG); raw content is always served as `text/plain`.
- Deletion tokens are never stored — only their SHA-256 hash.
- `--burn` shares content **verbatim** (not masked) and destroys it after the first read — it's meant for handing off a secret exactly once.

> Detection is best-effort (regex + heuristics). Don't treat the scanner as your only line of defense.

## Self-hosted

```bash
dumps config set url https://dumps.example.com
```

## Development

```bash
npm install
npm run dev      # local worker at http://localhost:8787
npm test         # vitest
npm run deploy   # production (Cloudflare Workers)
```

For API, scanner, limits, and architecture details, see [CLAUDE.md](CLAUDE.md).

---

MIT · PRs welcome (for large changes, open an issue first).
