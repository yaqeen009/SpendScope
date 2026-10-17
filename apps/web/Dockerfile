# syntax=docker/dockerfile:1

# SpendScope web image: the built SPA served by nginx, which also proxies
# `/api` to the API container so the browser only ever talks to one origin.
#
#   docker build -f apps/web/Dockerfile -t spendscope-web .

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci
# The web build type-checks first (`tsc --noEmit`), so a type error fails the
# image build rather than shipping.
RUN npm run build --workspace @spendscope/web

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# `.inc`, not `.conf`: `nginx.conf` auto-includes `/etc/nginx/conf.d/*.conf`, and
# this snippet must only be pulled in where it is explicitly wanted.
COPY apps/web/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
