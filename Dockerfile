FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV DATABASE_URL=file:/app/data/world.db RUST_LOG=info

FROM base AS web-build
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --include=dev --workspace=@our-little-world/web --workspace=@our-little-world/shared --include-workspace-root
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN npm run build --workspace=@our-little-world/shared
RUN npm run build --workspace=@our-little-world/web

FROM base AS api-dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY packages/shared/package.json packages/shared/package.json
# Prisma CLI is intentionally retained: each container startup applies committed migrations.
RUN npm ci --include=dev --workspace=@our-little-world/api --workspace=@our-little-world/shared --include-workspace-root
RUN npm run db:generate --workspace=@our-little-world/api
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY packages/shared packages/shared
RUN npm run build --workspace=@our-little-world/shared
RUN npm run build --workspace=@our-little-world/api

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STORAGE_DIR=/app/storage WEB_DIST_DIR=/app/apps/web/dist
COPY package.json package-lock.json .env.example ./
COPY --from=api-dependencies /app/node_modules ./node_modules
COPY --from=api-dependencies /app/apps/api ./apps/api
COPY --from=api-dependencies /app/packages/shared ./packages/shared
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
COPY scripts scripts
RUN mkdir -p /app/data /app/storage && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "--experimental-strip-types", "scripts/health.mts"]
CMD ["node", "--experimental-strip-types", "scripts/docker-entrypoint.mts"]
