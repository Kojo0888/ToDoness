# ---- build: compile the web app and bundle the server ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

# Manifests first, so installing dependencies is cached until they change.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
COPY integration/package.json integration/
COPY e2e/package.json e2e/
# Install scripts are skipped: nothing is run here, so native modules need no compiling.
RUN pnpm install --frozen-lockfile --ignore-scripts \
    --filter "@todoness/client..." --filter "@todoness/server..."

COPY . .
RUN pnpm --filter @todoness/client build && pnpm --filter @todoness/server build

# ---- run: only what the server needs ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/todoness.db \
    CLIENT_DIR=/app/public
WORKDIR /app

# The server bundle, its SQL migrations and a package.json that lists only the
# two native modules (better-sqlite3, @node-rs/argon2).
COPY --from=build /app/server/dist/ ./
RUN npm install --omit=dev --no-audit --no-fund \
    && mkdir -p /data && chown node:node /data
COPY --from=build /app/client/dist/ ./public/

USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "index.js"]
