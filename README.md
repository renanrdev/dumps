# dumps.sh

**Pastebin CLI-first para DevOps.** Do terminal pro link, sem mexer no formato e sem vazar segredo.

```bash
cat error.log | curl --data-binary @- https://dumps.sh
# → https://dumps.sh/k3x9Qz7m2P
```

- 📋 **Pipe direto** do terminal — `curl` ou o CLI `dumps`
- 🔒 **Segredos mascarados** por padrão (AWS, GitHub, JWT, Stripe…)
- ⏳ **Efêmero** — expira sozinho; `--burn` destrói na primeira leitura
- 🧾 **Formato preservado** byte a byte e URL raw pipeável para CI

## Instalação (CLI)

```bash
npm install -g @renanrdev/dumps
```

> Sem instalar nada? Use `curl --data-binary @- https://dumps.sh`.

## Uso

```bash
# Upload — a URL vai para stdout (pipeável)
cat error.log | dumps

# Com opções
kubectl describe pod x | dumps --ttl=1h --lang=yaml
make test 2>&1        | dumps --redact=block   # bloqueia se achar segredo
echo "$DB_PASSWORD"   | dumps --burn           # one-time secret

# Ler e deletar (token salvo automaticamente na criação)
dumps get <id>
dumps delete <id>
```

| Flag | Valores | Padrão |
|---|---|---|
| `--ttl` | `10m` `1h` `1d` `7d` `30d` | `1d` |
| `--redact` | `warn` `mask` `block` | `mask` |
| `--burn` | destrói na 1ª leitura | — |
| `--lang` | hint de linguagem | auto |

As mesmas opções funcionam via query no `curl`: `...?ttl=1h&redact=block&burn=1`.

## Segurança

- Segredos conhecidos são mascarados **no servidor** antes de persistir (`--redact=block` para rejeitar).
- IDs não enumeráveis (CSPRNG); raw sempre servido como `text/plain`.
- Token de deleção nunca é armazenado — só o hash SHA-256.

> A detecção é best-effort (regex + heurísticas). Não trate o scanner como única linha de defesa.

## Self-hosted

```bash
dumps config set url https://dumps.example.com
```

## Desenvolvimento

```bash
npm install
npm run dev      # worker local em http://localhost:8787
npm test         # vitest
npm run deploy   # produção (Cloudflare Workers)
```

Detalhes de API, scanner, limites e arquitetura: veja o [CLAUDE.md](CLAUDE.md).

---

MIT · PRs bem-vindos (para mudanças grandes, abra uma issue primeiro).
