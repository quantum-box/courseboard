FROM node:24-alpine AS base

# This Dockerfile is copy-pasted into our main docs at /docs/handbook/deploying-with-docker.
# Make sure you update both files!

FROM base AS builder
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
RUN apk update
# Set working directory
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY . .
RUN pnpm dlx turbo@2.5.4 prune --scope=courseboard-admin-ui --docker

# Add lockfile and package.json's of isolated subworkspace
FROM base AS installer
RUN apk add --no-cache libc6-compat
RUN apk update
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app

# First install the dependencies (as they change less often)
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Build the project
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json

# Uncomment and use build args to enable remote caching
# ARG TURBO_TEAM
# ENV TURBO_TEAM=$TURBO_TEAM

# ARG TURBO_TOKEN
# ENV TURBO_TOKEN=$TURBO_TOKEN
ARG NEXT_PUBLIC_BACKEND_API_URL
ARG INTEGRATION_API_URL
ARG AUTH_SECRET
ARG NEXTAUTH_SECRET
RUN touch .env.production
RUN echo "NEXT_PUBLIC_BACKEND_API_URL=$NEXT_PUBLIC_BACKEND_API_URL" >> .env.production
RUN echo "INTEGRATION_API_URL=$INTEGRATION_API_URL" >> .env.production

# AUTH_SECRET / NEXTAUTH_SECRET are embedded at build time because the
# courseboard-admin Cloud Run service does not inject them at runtime. They are
# read by `next.config.js` env and inlined into the standalone bundle.
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET

RUN pnpm exec turbo run build --filter=courseboard-admin-ui...

FROM node:24-alpine AS runner
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=installer /app/apps/admin-ui/next.config.js .
COPY --from=installer /app/apps/admin-ui/package.json .

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nextjs:nodejs /app/apps/admin-ui/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/admin-ui/.next/static ./apps/admin-ui/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/admin-ui/public ./apps/admin-ui/public

CMD node apps/admin-ui/server.js
