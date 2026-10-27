FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run lint && npm run build
FROM node:24-bookworm-slim AS backend
WORKDIR /build
COPY backend/package*.json ./
RUN npm ci --ignore-scripts
COPY backend/ ./
RUN npm run build && npm prune --omit=dev --ignore-scripts
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000
ENV PDF_CHROMIUM_PATH=/usr/bin/chromium
# Chromium runs as the existing unprivileged container user; the report template
# disables JavaScript and blocks all remote/file requests in the renderer.
ENV PDF_NO_SANDBOX=true
ENV XDG_CONFIG_HOME=/tmp/chromium-config XDG_CACHE_HOME=/tmp/chromium-cache
WORKDIR /app/backend
COPY --from=backend --chown=node:node /build/dist ./dist
COPY --from=backend --chown=node:node /build/node_modules ./node_modules
COPY --from=backend --chown=node:node /build/package.json ./package.json
COPY --from=backend --chown=node:node /build/scripts/verify-pdf-runtime.mjs ./scripts/verify-pdf-runtime.mjs
COPY --from=frontend --chown=node:node /build/dist /app/public
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
