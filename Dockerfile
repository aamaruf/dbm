# ==================== STAGE 1: Dependencies ====================
FROM node:20-alpine AS deps

RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies
RUN if [ -f yarn.lock ]; then yarn install --production --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci --only=production; \
    else npm install --only=production; fi

# ==================== STAGE 2: Runner ====================
FROM node:20-alpine AS runner

# Install database client tools (PostgreSQL, MySQL/MariaDB, MongoDB) and curl for healthcheck
RUN apk add --no-cache postgresql-client mariadb-client mongodb-tools curl

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy dependencies from deps stage
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create required directories with proper ownership
RUN mkdir -p /app/backups /app/logs /app/data && \
    chmod +x /app/docker-healthcheck.sh && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Environment variables (defaults, can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=7050

# Expose port
EXPOSE 7050

# Health check via script so runtime PORT is expanded by the shell
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["/app/docker-healthcheck.sh"]

# Start application
CMD ["node", "server.js"]
