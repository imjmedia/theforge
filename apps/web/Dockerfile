# syntax=docker/dockerfile:1.4
# Build stage — context = repo root
# Imágenes fijas en ECR Public (evita TLS timeout a Docker Hub y fallos de ARG en Dokploy).
FROM public.ecr.aws/docker/library/node:20-alpine AS builder

ARG BUILD_CACHE_BUST=97
RUN echo "Cache bust key: ${BUILD_CACHE_BUST}"

WORKDIR /app
RUN apk add --no-cache gcompat

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/business-rules/package.json packages/business-rules/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=theforge-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config packages/config
COPY packages/shared-types packages/shared-types
COPY packages/business-rules packages/business-rules
COPY apps/web apps/web

RUN pnpm exec turbo run build --filter=@theforge/web

# Production stage — Nginx
FROM public.ecr.aws/docker/library/nginx:alpine AS runner

RUN apk add --no-cache wget

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Healthcheck en docker-compose.yml (wget → http://theforge-web:80/). No usar 127.0.0.1 en Dokploy UI.

CMD ["nginx", "-g", "daemon off;"]
