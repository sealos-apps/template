FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat git ca-certificates \
  && corepack enable \
  && corepack prepare pnpm@8.9.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable \
  && corepack prepare pnpm@8.9.0 --activate \
  && pnpm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache git ca-certificates \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  HOME=/home/nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The server refreshes the template repository and receives config.yaml through
# a subPath mount at runtime, so both locations must exist and be writable.
RUN mkdir -p /app/data /home/nextjs \
  && chown nextjs:nodejs /app /app/data /home/nextjs

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
