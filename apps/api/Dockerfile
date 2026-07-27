# syntax=docker/dockerfile:1.4
# Build stage — context = repo root
# Imágenes fijas en ECR Public (evita TLS timeout a Docker Hub y fallos de ARG en Dokploy).
FROM public.ecr.aws/docker/library/node:20-alpine AS builder

ARG BUILD_CACHE_BUST=99
ARG GIT_SHA=unknown
RUN echo "Cache bust key: ${BUILD_CACHE_BUST} git: ${GIT_SHA}"

RUN apk add --no-cache gcompat openssl

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY packages/database/package.json packages/database/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/business-rules/package.json packages/business-rules/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/

RUN --mount=type=cache,id=theforge-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/database packages/database
COPY packages/shared-types packages/shared-types
COPY packages/business-rules packages/business-rules
COPY packages/config packages/config
COPY apps/api apps/api
COPY scripts/rotate-master-key.ts scripts/rotate-master-key.ts

ENV DATABASE_URL="postgresql://local:local@db:5432/theforge"
ENV THEFORGE_BUILD_SHA="${GIT_SHA}"
# Validación post-build detecta dist obsoleto (injection tokens / forwardRef). Sin --force: turbo
# reutiliza paquetes sin cambios (database, shared-types) y acorta rebuilds incrementales.
RUN pnpm exec turbo run build \
  --filter=@theforge/database \
  --filter=@theforge/shared-types \
  --filter=@theforge/business-rules \
  --filter=@theforge/api \
  && test ! -e apps/api/dist/injection-tokens.js \
  && node -e "const fs=require('fs');const p='apps/api/dist/modules/projects/deliverables-queue.service.js';const s=fs.readFileSync(p,'utf8');if(!s.includes('forwardRef')){console.error('missing forwardRef in',p);process.exit(1)}if(s.includes('PROJECTS_SERVICE_TOKEN')){console.error('stale injection token in',p);process.exit(1)}" \
  && test -f packages/shared-types/dist-cjs/index.js \
  && node -e "const fs=require('fs');const p='apps/api/dist/app.module.js';const s=fs.readFileSync(p,'utf8');if(!s.includes('sessions_module_js_1')){console.error('truncated AppModule in',p);process.exit(1)}"

# Production stage — layout pnpm hoisted desde builder
FROM public.ecr.aws/docker/library/node:20-alpine AS runner

RUN apk add --no-cache wget openssl postgresql-client

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ARG GIT_SHA=unknown
ENV THEFORGE_BUILD_SHA="${GIT_SHA}"

COPY --from=builder /app .
COPY apps/api/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# entrypoint: wait DB → prisma migrate deploy → node (no sobrescribir CMD en Dokploy)

WORKDIR /app/apps/api

EXPOSE 3000

# HEALTHCHECK desactivado: Dokploy no lo soporta correctamente
# HEALTHCHECK NONE

ENTRYPOINT ["/entrypoint.sh"]
