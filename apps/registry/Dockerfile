FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/prisma/package.json ./packages/prisma/
COPY packages/shared/package.json ./packages/shared/
COPY apps/registry/package.json ./apps/registry/
RUN pnpm install --frozen-lockfile

# Builder
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/prisma/node_modules ./packages/prisma/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/registry/node_modules ./apps/registry/node_modules
COPY . .
RUN pnpm --filter @mcp-manager/prisma run generate
RUN pnpm --filter @mcp-manager/shared run build
RUN pnpm --filter @mcp-manager/registry run build

# Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 mcpuser

COPY --from=builder /app/packages/prisma/generated ./packages/prisma/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/registry/dist ./apps/registry/dist
COPY --from=builder /app/apps/registry/package.json ./apps/registry/
COPY --from=builder /app/node_modules ./node_modules

USER mcpuser

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

CMD ["node", "apps/registry/dist/index.js"]
