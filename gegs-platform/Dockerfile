# Phase 1 §15.2: images are immutable and SHA-tagged; a rollback points at the
# previous SHA.
#
# Milestone 2 changed the ENTRYPOINT only. `next start` cannot provide the TCP
# peer address (Next.js 15 removed NextRequest.ip and exposes no socket), so the
# container now runs the custom server in server.ts, which captures it. The
# deploy unit is unchanged.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Never run as root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Production dependencies only. server.ts imports `next` at runtime, so
# node_modules must be present — standalone output is not used (see
# next.config.ts).
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/assets ./assets
COPY --chown=nextjs:nodejs server.ts package.json ./
COPY --chown=nextjs:nodejs src/lib/auth/client-ip.ts ./src/lib/auth/client-ip.ts

USER nextjs
EXPOSE 3000
# Node 22 strips TypeScript natively, so server.ts runs without a build step.
# No secret is baked into the image; every value arrives from the environment.
CMD ["node", "server.ts"]
