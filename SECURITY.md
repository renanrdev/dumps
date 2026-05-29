# Security Policy

## Reporting a Vulnerability

Please report security issues **privately** — do not open a public GitHub issue
for anything exploitable.

Preferred channels:

1. **GitHub Security Advisories** — open a private report via the repository's
   **Security → Report a vulnerability** tab. This is the preferred route.
2. **Email** — `renanr.dev@gmail.com` with a clear description and, ideally,
   reproduction steps or a proof of concept.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (or a PoC).
- The affected component: the Cloudflare Worker (`dumps.sh`) or the
  `@renanrdev/dumps` npm CLI, and the version/commit if known.

You can expect an initial acknowledgement within **72 hours**. Once a fix is
released, we're happy to credit reporters who wish to be named.

## Supported Versions

This is a single actively-maintained line; fixes land on `main` and the latest
published `@renanrdev/dumps` release. Older CLI versions are not patched —
please upgrade to the latest before reporting.

## Scope Notes

`dumps.sh` is an **anonymous, ephemeral pastebin**. By design:

- Pastes are public to anyone who holds the URL (IDs are unguessable, CSPRNG-generated).
- `?burn=1` / `--burn` shares content **verbatim** (secrets are not masked) and
  destroys it after the first read — this is intended behavior, not a leak.
- The secret scanner (`mask` mode, default) is a best-effort safety net, **not**
  a guarantee that all secrets are caught. Treat it as defense-in-depth.

Reports about these documented behaviors are not considered vulnerabilities.
