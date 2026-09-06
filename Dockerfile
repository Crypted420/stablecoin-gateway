# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy package manifests first so dependency installation stays cached while
# application source code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/evaluation/package.json ./apps/evaluation/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/broker/package.json ./packages/broker/package.json
COPY packages/chain/package.json ./packages/chain/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/providers/package.json ./packages/providers/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build

# API, worker, migration and evaluation processes share this runtime. Keeping
# the workspace links intact is important because the applications import the
# local @gateway/* packages at runtime.
FROM node:22-alpine AS app

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/evaluation/package.json ./apps/evaluation/package.json
COPY --from=build --chown=node:node /app/apps/evaluation/node_modules ./apps/evaluation/node_modules
COPY --from=build --chown=node:node /app/apps/evaluation/dist ./apps/evaluation/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /app/packages ./packages

USER node
CMD ["node", "apps/api/dist/index.js"]

# Nginx serves the compiled React application and forwards /api requests to the
# API container. This is smaller and more reliable than a Vite preview server.
FROM nginx:1.27-alpine AS web

COPY ops/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
