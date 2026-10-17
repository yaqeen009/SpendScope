# syntax=docker/dockerfile:1

# SpendScope API image.
#
# Build from the repository root, because this is an npm workspace and the API
# imports `@spendscope/shared`:
#
#   docker build -f apps/api/Dockerfile -t spendscope-api .
#
# Three targets:
#   build    full install, Prisma client generation, `tsup` bundle
#   migrate  the `build` stage plus the Prisma CLI, used to run `migrate deploy`
#   runtime  production dependencies plus the compiled server (default)

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# `prisma.config.ts` reads DATABASE_URL via `env()`, which throws when it is
# missing. Generation does not connect, so a placeholder is enough here.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci
RUN npm run db:generate
RUN npm run build --workspace @spendscope/api

# ---------------------------------------------------------------------------
# migrate (one-shot job; see docker-compose.yml)
# ---------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /app/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Production dependencies only. `packages/shared` is copied because npm needs
# the workspace directory to exist; the API bundle already contains its code.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/api/dist ./apps/api/dist
# Migrations and the schema ship with the image so a release can migrate itself
# with the `migrate` target above.
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

# Run as a non-root user.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Liveness only: it must not depend on the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
