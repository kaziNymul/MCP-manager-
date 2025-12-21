FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/admin-ui/package.json ./apps/admin-ui/
RUN pnpm install --frozen-lockfile

# Builder
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/admin-ui/node_modules ./apps/admin-ui/node_modules
COPY . .

# Build Next.js
WORKDIR /app/apps/admin-ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/admin-ui/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-ui/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-ui/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
