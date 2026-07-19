# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install all deps (incl. dev) for the TypeScript build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build   # tsc → dist/

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS + the static data files the shipping logic reads at runtime
# (territoryResolver / orderValidation resolve ../../data → /app/data).
COPY --from=build /app/dist ./dist
COPY data ./data

# Labels are written at runtime; give the non-root user a writable dir.
RUN mkdir -p /app/labels /app/output && chown -R node:node /app
USER node

EXPOSE 3000

# Container-level liveness probe → shallow /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/scripts/startServer.js"]
