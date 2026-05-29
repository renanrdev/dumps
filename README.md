# dumps.sh

**Pastebin CLI-first para DevOps.** Do terminal pro link, sem mexer no formato e sem vazar segredo.

```bash
# com curl (sem instalar nada)
cat error.log | curl --data-binary @- https://dumps.sh

# com o CLI dumps
cat error.log | dumps
```

```
→ https://dumps.sh/k3x9Qz7m2P
```

---

## Por que dumps.sh?

Compartilhar artefatos de operação hoje cai em dois baldes ruins: colar direto no chat (truncado, corrompe YAML, vaza segredos) ou usar o Gist (sem redação, sem efemeridade, sem ergonomia de terminal). O dumps.sh existe para ser o terceiro caminho — especializado para DevOps:

| | Slack/chat | Gist | **dumps.sh** |
|---|---|---|---|
| Pipe direto do terminal | ❌ | ❌ | ✅ |
| Formato preservado byte a byte | ❌ | ✅ | ✅ |
| Segredos mascarados por padrão | ❌ | ❌ | ✅ |
| Efêmero por padrão | ❌ | ❌ | ✅ |
| Burn-after-read | ❌ | ❌ | ✅ |
| URL raw pipeável para CI | ❌ | ⚠️ | ✅ |

---

## Quick start

### Com o CLI `dumps` (recomendado)

```bash
npm install -g dumps-sh
```

```bash
# Paste simples — URL vai para stdout, pipeável
cat error.log | dumps

# kubectl com TTL de 1 hora
kubectl describe pod x | dumps --ttl=1h --lang=yaml

# Bloqueia o upload se encontrar segredos
make test 2>&1 | dumps --redact=block

# One-time secret — destruído na primeira leitura
echo "$DB_PASSWORD" | dumps --burn

# Capturar a URL numa variável
URL=$(terraform plan 2>&1 | dumps)
gh pr comment --body "Plan: $URL"
```

### Com curl (sem instalar nada)

```bash
# Paste simples
cat error.log | curl --data-binary @- https://dumps.sh

# Com parâmetros
kubectl describe pod x | curl --data-binary @- "https://dumps.sh?ttl=1h"
make test 2>&1 | curl --data-binary @- "https://dumps.sh?redact=block"
echo "$DB_PASSWORD" | curl --data-binary @- "https://dumps.sh?burn=1"
```

---

## CLI `dumps`

### Instalação

```bash
npm install -g dumps-sh   # instala globalmente
npx dumps-sh --help       # sem instalar
```

### Uso

```bash
# Upload (caso principal — lê do stdin)
<stdin> | dumps [flags]

# Ler conteúdo de um paste
dumps get <id>
dumps get <id> > arquivo.txt

# Deletar um paste
dumps delete <id>                    # usa token salvo automaticamente
dumps delete <id> --token=del_xxx   # token explícito

# Configuração
dumps config set url https://self-hosted.example.com
dumps config get url
```

### Flags de upload

| Flag | Valores | Padrão | Descrição |
|---|---|---|---|
| `--ttl` | `10m` `1h` `1d` `7d` `30d` | `1d` | Tempo de vida |
| `--redact` | `warn` `mask` `block` | `mask` | Modo de redação |
| `--burn` | — | — | Destrói na primeira leitura |
| `--lang` | `yaml` `json` `hcl` … | auto | Hint de linguagem |

### Token de deleção

O CLI salva os tokens de deleção automaticamente em `~/.dumps/tokens.json` (permissão `600`) na criação de cada paste. O `dumps delete <id>` usa esse token sem precisar de `--token`.

```bash
# Criação salva o token automaticamente
cat log.txt | dumps
# → http://dumps.sh/k3x9Qz7m2P
# → Deletion token saved to ~/.dumps/tokens.json (id: k3x9Qz7m2P)

# Deleção usa o token salvo
dumps delete k3x9Qz7m2P
# → Deleted: k3x9Qz7m2P
```

O token também pode ser passado via variável de ambiente `DUMPS_TOKEN`.

### Instância self-hosted

```bash
dumps config set url https://dumps.example.com
echo "hello" | dumps   # aponta para sua instância
```

---

## Parâmetros de query (API / curl)

| Parâmetro | Valores | Padrão | Descrição |
|---|---|---|---|
| `?ttl` | `10m` `1h` `1d` `7d` `30d` | `1d` | Tempo de vida do paste |
| `?redact` | `warn` `mask` `block` | `mask` | Modo de redação de segredos |
| `?burn` | `1` | — | Destrói na primeira leitura |
| `?lang` | `yaml` `json` `hcl` `diff` … | auto | Hint de linguagem para o render |

---

## Redação automática de segredos

O scanner roda **no servidor** antes de persistir qualquer conteúdo. Por padrão (`mask`), segredos conhecidos são substituídos por tags antes de gerar o link.

```bash
echo "AKIAIOSFODNN7EXAMPLE" | dumps
# guardado como: ‹REDACTED:aws_access_key_id›
# stderr: Redacted: aws_access_key_id
```

### Tipos detectados

| Tipo | Exemplos de padrão |
|---|---|
| `aws_access_key_id` | `AKIA[0-9A-Z]{16}` |
| `aws_secret_access_key` | `aws_secret_access_key = …` |
| `github_token` | `ghp_`, `gho_`, `ghs_` |
| `slack_token` | `xoxb-`, `xoxp-`, `xoxs-` |
| `stripe_secret_key` | `sk_live_…` |
| `jwt` | `eyJ….eyJ….…` |
| `pem_private_key` | `-----BEGIN … PRIVATE KEY-----` |
| `authorization_bearer` | `Authorization: Bearer …` |
| `connection_string_password` | `postgres://user:senha@host` |
| `generic_password` | `password=`, `secret=`, `api_key=` |

### Modos de redação

| Modo | Comportamento |
|---|---|
| `mask` *(padrão)* | Substitui o segredo por `‹REDACTED:tipo›` e publica |
| `warn` | Publica sem modificar; registra os tipos encontrados nos headers |
| `block` | Rejeita com `422` e retorna as localizações (sem o valor) |

> **Atenção:** a detecção é *best-effort* com regex + heurísticas. Segredos codificados em base64, hex ou com formatação incomum podem não ser detectados. Use `--redact=block` em pipelines críticos e não trate o scanner como única linha de defesa.

---

## API HTTP

### Criar um paste

```
POST /
```

**Resposta para curl / `X-Dumps-Plain: 1`:**
```
HTTP/2 201
X-Deletion-Token: del_8f2c4a…
X-Paste-ID: k3x9Qz7m2P

https://dumps.sh/k3x9Qz7m2P
```

**Resposta para browser (`Accept: application/json`):**
```json
{
  "id": "k3x9Qz7m2P",
  "url": "https://dumps.sh/k3x9Qz7m2P",
  "deletion_token": "del_8f2c4a…",
  "redaction_applied": true,
  "redaction_types": ["aws_access_key_id"]
}
```

### Ler um paste

```
GET /{id}          → página HTML com render e highlight
GET /raw/{id}      → conteúdo bruto (sempre text/plain, nunca text/html)
```

### Deletar um paste

```
DELETE /{id}
X-Deletion-Token: del_8f2c4a…

→ HTTP/2 204
```

### Health check

```
GET /healthz  → { "status": "ok" }
```

### Respostas de erro

| Status | Código | Situação |
|---|---|---|
| `400` | `EMPTY_BODY` | Corpo da requisição vazio |
| `413` | `TOO_LARGE` | Payload acima de 1 MB |
| `422` | `SECRETS_BLOCKED` | Segredos detectados com `redact=block` |
| `429` | — | Rate limit excedido (`Retry-After: 60`) |

---

## Segurança

- **IDs não enumeráveis** — gerados com CSPRNG base62, ~10^17 combinações.
- **Token de deleção secreto** — devolvido apenas na criação; o servidor armazena só o hash SHA-256. Nunca o token em si.
- **Raw sempre `text/plain`** — conteúdo de usuário nunca é servido como `text/html`, independente do que foi enviado.
- **Headers de segurança** em todas as respostas: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`.
- **Burn-after-read atômico** — o paste é deletado antes de retornar a resposta; segunda leitura retorna 404.
- **Deleção não vaza existência** — DELETE retorna `403` tanto para paste inexistente quanto para token errado.

---

## Limites

| Recurso | Limite |
|---|---|
| Tamanho máximo do paste | 1 MB |
| TTL máximo | 30 dias |
| Rate limit | 20 req burst / 2 req/s por IP |

---

## Desenvolvimento local

### Pré-requisitos

- [Node.js](https://nodejs.org/) 18+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### Instalar dependências

```bash
npm install
```

### Comandos do worker

```bash
npm run dev           # servidor local em http://localhost:8787
npm test              # todos os testes (vitest)
npm run test:watch    # modo watch
npm run build         # type-check (tsc --noEmit)
npm run deploy        # deploy para produção
npm run deploy:staging
```

### Comandos do CLI

```bash
npm run build:cli     # compila packages/cli/dist/cli.js
```

### Testar o CLI contra o servidor local

```bash
# Terminal 1 — inicia o worker
npm run dev

# Terminal 2 — configura o CLI para usar localhost
node packages/cli/dist/cli.js config set url http://localhost:8787

# Testa os principais fluxos
echo "hello world" | node packages/cli/dist/cli.js
node packages/cli/dist/cli.js get <id>
node packages/cli/dist/cli.js delete <id>
```

### Rodar um teste específico

```bash
npx vitest run test/scanner.test.ts
```

---

## Arquitetura

TypeScript Cloudflare Workers seguindo Clean Architecture. Dependências apontam para dentro: `handlers → application → domain ← infrastructure`.

```
dumps/
├── src/                        — Cloudflare Worker
│   ├── index.ts                — entry point, router, exporta RateLimiterDO
│   ├── domain/                 — funções puras, sem I/O, sem deps Cloudflare
│   │   ├── paste.ts            — tipos, parseTTL, parseRedactMode, detectLang
│   │   ├── scanner.ts          — RULES + scan(content, mode) → ScanResult
│   │   └── id_generator.ts     — generateId() CSPRNG base62, generateDeletionToken()
│   ├── application/            — casos de uso, dependem só de ports
│   │   ├── create_paste.ts     — validate → scan → store blob → store metadata
│   │   ├── get_paste.ts        — fetch metadata + blob, burn-after-read
│   │   └── delete_paste.ts     — verifica hash do token, remove blob + metadata
│   ├── infrastructure/         — adaptadores para bindings Cloudflare
│   │   ├── blob_store.ts       — BlobStore interface + R2BlobStore
│   │   ├── meta_store.ts       — MetadataStore interface + KVMetadataStore
│   │   └── rate_limiter.ts     — RateLimiterDO (token bucket por IP)
│   └── handlers/
│       ├── create.ts / get.ts / delete.ts / health.ts
│       └── shared.ts           — securityHeaders(), htmlSecurityHeaders()
├── packages/
│   └── cli/                    — pacote npm `dumps-sh`
│       └── src/cli.ts          — CLI TypeScript (Node 18+, zero deps runtime)
└── test/                       — Vitest (Node environment, fakes em memória)
```

**Bindings Cloudflare** (wrangler.toml):

| Binding | Tipo | Uso |
|---|---|---|
| `PASTE_BUCKET` | R2 | Blobs em `blob/{id}` |
| `PASTE_META` | KV | Metadata JSON em `paste:{id}` com TTL |
| `RATE_LIMITER` | Durable Objects | Token bucket, 20 burst / 2 req/s por IP |

---

## Testes

```
test/
  scanner.test.ts        — true positives, true negatives, modos, ReDoS safety
  id_generator.test.ts   — CSPRNG, geração e verificação de tokens
  paste.test.ts          — parseTTL, parseRedactMode, detectLang, header injection
  create.test.ts         — use case CreatePaste com fakes em memória
  get_paste.test.ts      — use case GetPaste, expiração, burn-after-read
  delete_paste.test.ts   — use case DeletePaste, token verification
  handlers.test.ts       — testes HTTP end-to-end com env fake (116 testes)
```

```bash
npm test                          # todos os testes
npx vitest run test/scanner.test.ts   # arquivo específico
```

---

## Contribuindo

Veja [docs/adr-0001-dumps-sh.md](docs/adr-0001-dumps-sh.md) para o ADR completo com decisões arquiteturais, threat model e roadmap por fases.

Pull requests são bem-vindos. Para mudanças grandes, abra uma issue primeiro.
