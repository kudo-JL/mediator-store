# Dockerfile for mediator-store
# Multi-stage build: install deps in a builder, then copy only what's needed
# into a slim runtime image. Result: ~180 MB image.

# ---- Builder ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---- Runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system app && useradd --system --gid app --home /app --shell /sbin/nologin app \
 && mkdir -p /app/data /app/uploads/products /app/lib/fonts \
 && chown -R app:app /app

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

RUN curl -fsSL -o /app/lib/fonts/Amiri-Regular.ttf \
      https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf \
 && chown app:app /app/lib/fonts/Amiri-Regular.ttf

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

RUN chown -R app:app /app/data /app/uploads /app/lib/fonts

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

CMD ["sh", "-c", "chown -R app:app /app/data /app/uploads 2>/dev/null || true; exec node server.js"]
