#!/usr/bin/env bash
# scripts/setup.sh — First-time setup for dumps.sh development.
# Usage: bash scripts/setup.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[setup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
error()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Prerequisites check
# ---------------------------------------------------------------------------
info "Checking prerequisites..."
command -v node >/dev/null || error "Node.js not found. Install from https://nodejs.org"
command -v npm  >/dev/null || error "npm not found."
command -v wrangler >/dev/null 2>&1 || warn "wrangler not found globally — will use npx wrangler."

NODE_VERSION=$(node --version | sed 's/v//')
MAJOR="${NODE_VERSION%%.*}"
if [ "$MAJOR" -lt 18 ]; then
  error "Node.js 18+ required (found $NODE_VERSION)."
fi
info "Node.js $NODE_VERSION — OK"

# ---------------------------------------------------------------------------
# 2. Install dependencies
# ---------------------------------------------------------------------------
info "Installing npm dependencies..."
npm install

# ---------------------------------------------------------------------------
# 3. Generate wrangler types
# ---------------------------------------------------------------------------
info "Generating Cloudflare Workers TypeScript types..."
npx wrangler types || warn "wrangler types failed — you may need to authenticate first."

# ---------------------------------------------------------------------------
# 4. Type-check
# ---------------------------------------------------------------------------
info "Running TypeScript type check..."
npm run build

# ---------------------------------------------------------------------------
# 5. Run tests
# ---------------------------------------------------------------------------
info "Running tests..."
npm test

# ---------------------------------------------------------------------------
# 6. Instructions for Cloudflare resources
# ---------------------------------------------------------------------------
echo ""
info "Setup complete! Next steps for deployment:"
echo ""
echo "  1. Authenticate with Cloudflare:"
echo "     npx wrangler login"
echo ""
echo "  2. Create KV namespace for metadata:"
echo "     npx wrangler kv namespace create PASTE_META"
echo "     # Copy the returned ID into wrangler.toml → kv_namespaces[0].id"
echo ""
echo "  3. Create R2 bucket for blobs:"
echo "     npx wrangler r2 bucket create dumps-paste-blobs"
echo ""
echo "  4. (Optional) For local dev with Cloudflare bindings:"
echo "     npm run dev"
echo ""
echo "  5. Deploy to staging:"
echo "     npm run deploy:staging"
echo ""
echo "  6. Deploy to production:"
echo "     npm run deploy"
echo ""
