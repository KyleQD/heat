# HEAT API — production image (Phase C).
# Multi-stage: deps → build (tsc) → slim runtime. Non-root, healthchecked.
#
# Build:  docker build -f apps/api/Dockerfile -t heat-api .
# Run:    docker run -p 8787:8787 -e DATABASE_URL=... heat-api

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/api-contracts/package.json packages/api-contracts/
COPY packages/config/package.json packages/config/
RUN npm ci --workspace @heat/api --include-workspace-root=false || npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
RUN npx tsc --noEmit -p apps/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r heat && useradd -r -g heat heat
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY packages/domain/tsconfig.json packages/domain/
COPY packages/api-contracts/package.json packages/api-contracts/
COPY packages/api-contracts/src packages/api-contracts/src
COPY packages/api-contracts/tsconfig.json packages/api-contracts/
COPY packages/config/package.json packages/config/
COPY packages/config/src packages/config/src
COPY packages/config/tsconfig.json packages/config/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
USER heat
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/v1/health').then(r=>{if(!r.ok)throw 0}).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "apps/api/src/server.ts"]
