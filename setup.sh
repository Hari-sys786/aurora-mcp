#!/usr/bin/env bash
# aurora-mcp — one-shot install & run (Linux/macOS).
#   curl -sL https://raw.githubusercontent.com/Hari-sys786/aurora-mcp/main/setup.sh | bash
set -e

REPO_DIR="${AURORA_MCP_DIR:-$HOME/aurora-mcp}"
PORT="${PORT:-3100}"

echo "==> aurora-mcp one-click setup"

# 1. source
if [ ! -d "$REPO_DIR/src" ]; then
  echo "==> cloning repo -> $REPO_DIR"
  git clone --depth 1 https://github.com/Hari-sys786/aurora-mcp.git "$REPO_DIR"
fi
cd "$REPO_DIR"

# 2. aurora-cli backend (only external piece)
if [ -z "$AURORA_CLI" ] || [ ! -x "$AURORA_CLI" ]; then
  CAND="$REPO_DIR/../aurora-cli/aurora-cli-bin"
  if [ -x "$CAND" ]; then
    AURORA_CLI="$CAND"
  else
    ARCH="$(uname -m)"
    ASSET=""
    case "$ARCH" in
      aarch64|arm64) ASSET="aurora-cli-linux-aarch64" ;;
    esac
    if [ -n "$ASSET" ]; then
      echo "==> downloading aurora-cli release ($ASSET)"
      AURORA_CLI="$REPO_DIR/aurora-cli-bin"
      curl -sL -o "$AURORA_CLI" "https://github.com/Hari-sys786/aurora-cli/releases/download/v0.1.0/$ASSET"
      chmod +x "$AURORA_CLI"
    else
      echo "==> no prebuilt for $ARCH — building aurora-cli from source (requires cargo)"
      git clone --depth 1 https://github.com/Hari-sys786/aurora-cli.git /tmp/aurora-cli-src
      (cd /tmp/aurora-cli-src && cargo build --release)
      AURORA_CLI=/tmp/aurora-cli-src/target/release/aurora-cli
    fi
  fi
fi
export AURORA_CLI
echo "==> aurora-cli: $AURORA_CLI"
"$AURORA_CLI" token >/dev/null 2>&1 || true

# 3. deps + build
[ -d node_modules ] || npm install --no-audit --no-fund
npm run build

# 4. run (idempotent)
if curl -sf -o /dev/null "http://localhost:$PORT/mcp"; then
  echo "==> already running on :$PORT"
else
  echo "==> starting on :$PORT"
  (PORT="$PORT" nohup node dist/index.js >/tmp/aurora-mcp.log 2>&1 &)
  sleep 2
fi
echo "==> ready  http://localhost:$PORT/mcp"
echo "    tools:   npx mcp-use client connect aurora http://localhost:$PORT/mcp"
echo "    inspector: http://localhost:$PORT/inspector"
