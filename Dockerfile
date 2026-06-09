# ══════════════════════════════════════════════════════════════════════════════
# AVERON — Multi-stage Docker Build
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install ───────────────────────────────────────────────────────────
FROM node:22-alpine AS installer
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S averon && adduser -S averon -u 1001 -G averon

# Copy production deps
COPY --from=installer /app/node_modules ./node_modules

# Copy application
COPY . .

# Create data/uploads directories (owned by averon)
RUN mkdir -p data uploads && chown -R averon:averon /app

USER averon

EXPOSE 4200

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4200)+'/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{const j=JSON.parse(b);process.exit(j.status==='healthy'?0:1)})}).on('error',()=>process.exit(1))"

ENV NODE_ENV=production
ENV CLUSTER=true

CMD ["node", "server.js"]
