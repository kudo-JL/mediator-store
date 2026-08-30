#!/usr/bin/env bash
# scripts/check-stack.sh
# Helper: inspect a Node project to detect its stack (Express, Next.js, etc.)
# Usage:
#   ./scripts/check-stack.sh /path/to/project
#   cd /path/to/project && bash /workspace/mediator-store/scripts/check-stack.sh
#
# This script never modifies anything; it only reads.

set -e
DIR="${1:-$PWD}"

if [ ! -d "$DIR" ]; then
  echo "Not a directory: $DIR"
  exit 1
fi

cd "$DIR"

echo "============================================================"
echo "  Stack check for: $DIR"
echo "============================================================"

# package.json?
if [ -f package.json ]; then
  echo
  echo "[package.json] found"
  echo "  name:        $(node -e 'console.log(require("./package.json").name||"-")' 2>/dev/null)"
  echo "  version:     $(node -e 'console.log(require("./package.json").version||"-")' 2>/dev/null)"
  echo "  type:        $(node -e 'console.log(require("./package.json").type||"commonjs")' 2>/dev/null)"
  PKG_DEPS=$(node -e 'const p=require("./package.json");console.log(Object.keys({...(p.dependencies||{}),...(p.devDependencies||{})}).join(" "))' 2>/dev/null)
  echo "  dependencies: $PKG_DEPS" | tr ' ' '\n' | sed 's/^/    - /'

  # Detect framework
  echo
  echo "[Detected framework]"
  if echo "$PKG_DEPS" | grep -q '\bnext\b'; then
    echo "  -> Next.js  (React-based, full-stack)"
  elif echo "$PKG_DEPS" | grep -q '\bnuxt\b'; then
    echo "  -> Nuxt     (Vue-based, full-stack)"
  elif echo "$PKG_DEPS" | grep -q '\bnestjs\b\|@nestjs/core'; then
    echo "  -> NestJS   (Angular-style Node framework)"
  elif echo "$PKG_DEPS" | grep -q '\bexpress\b'; then
    echo "  -> Express  (minimal Node.js framework)"
  elif echo "$PKG_DEPS" | grep -q '\bkoa\b'; then
    echo "  -> Koa"
  elif echo "$PKG_DEPS" | grep -q '\bfastify\b'; then
    echo "  -> Fastify"
  elif echo "$PKG_DEPS" | grep -q '\breact\b'; then
    echo "  -> React only (static SPA, needs adapter for server-side)"
  else
    echo "  -> (none of the popular Node frameworks detected)"
  fi

  # Detect Node version requirement
  if grep -q '"engines"' package.json; then
    echo
    echo "[engines] $(node -e 'console.log(JSON.stringify(require("./package.json").engines||{}))' 2>/dev/null)"
  fi

  # Detect start script
  echo
  echo "[scripts.start] $(node -e 'console.log((require("./package.json").scripts||{}).start||"(none)")' 2>/dev/null)"

else
  echo "[package.json] NOT found"
fi

# Detected languages / frameworks via other files
echo
echo "[Other signals]"
if [ -f next.config.js ] || [ -f next.config.mjs ] || [ -f next.config.ts ]; then echo "  - next.config present"; fi
if [ -f nuxt.config.js ] || [ -f nuxt.config.ts ]; then echo "  - nuxt.config present"; fi
if [ -f angular.json ]; then echo "  - angular.json present"; fi
if [ -f vite.config.js ] || [ -f vite.config.ts ]; then echo "  - vite.config present"; fi
if [ -d src ] && [ -f src/main.js ] || [ -d src ] && [ -f src/main.ts ]; then echo "  - src/main.* (could be Vue/React entry)"; fi
if [ -f composer.json ]; then echo "  - composer.json (PHP)"; fi
if [ -f requirements.txt ] || [ -f pyproject.toml ]; then echo "  - Python project"; fi
if [ -f go.mod ]; then echo "  - Go project"; fi
if [ -f Cargo.toml ]; then echo "  - Rust project"; fi
if [ -f Gemfile ]; then echo "  - Ruby project"; fi

# Dockerfile?
echo
if [ -f Dockerfile ]; then
  echo "[Dockerfile] present (you can deploy with Coolify easily)"
else
  echo "[Dockerfile] NOT present (Coolify can build one for you, but it's better to have your own)"
fi

# Database hints
echo
echo "[Database signals]"
if [ -f data/*.db ] 2>/dev/null; then echo "  - SQLite in data/"; fi
if grep -q 'better-sqlite3\|sqlite3' package.json 2>/dev/null; then echo "  - sqlite3 in deps"; fi
if grep -q 'pg\|postgres' package.json 2>/dev/null; then echo "  - PostgreSQL client in deps"; fi
if grep -q 'mongoose\|mongodb' package.json 2>/dev/null; then echo "  - MongoDB client in deps"; fi
if grep -q 'mysql\|mysql2' package.json 2>/dev/null; then echo "  - MySQL client in deps"; fi

# Port (from .env, package.json, or detect)
echo
echo "[Port]"
PORT=$(node -e 'try{const env=require("fs").readFileSync(".env","utf8");const m=env.match(/^PORT=(\d+)/m);console.log(m?m[1]:"-")}catch{console.log("-")}' 2>/dev/null)
if [ "$PORT" = "-" ]; then
  PORT=$(grep -oE 'listen\(.*[0-9]{4}' server.js app.js index.js 2>/dev/null | grep -oE '[0-9]{4}' | head -1)
fi
[ -n "$PORT" ] && echo "  - PORT env: $PORT" || echo "  - PORT env: (not set, default 3000)"

echo
echo "============================================================"
echo "  Done."
echo "============================================================"
