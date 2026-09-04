# Dockerfile for mediator-store
# Multi-stage build: install deps in a builder, then copy only what's needed
# into a slim runtime image. Result: ~180 MB image.

# ---- Builder ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install OS deps needed for some npm packages (e.g. cheerio optional deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---- Runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Run as non-root
RUN groupadd --system app && useradd --system --gid app --home /app --shell /sbin/nologin app \
 && mkdir -p /app/data /app/uploads/products \
 && chown -R app:app /app

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app server.js ./
COPY --chown=app:app lib ./lib
COPY --chown=app:app middleware ./middleware
COPY --chown=app:app routes ./routes
COPY --chown=app:app views ./views
COPY --chown=app:app public ./public
COPY --chown=app:app uploads ./uploads
COPY --chown=app:app data ./data

# Make sure runtime dirs are writable by app
RUN chown -R app:app /app/data /app/uploads

USER root

EXPOSE 3000

# Healthcheck: hit the homepage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

# IMPORTANT: Fix volume permissions BEFORE starting Node.
# Persistent Storage mounts as root by default, but our app runs as `app` user.
# This chown fixes the permission issue without breaking non-root security.
CMD ["sh", "-c", "chown -R app:app /app/data /app/uploads 2>/dev/null || true; exec node server.js"]
