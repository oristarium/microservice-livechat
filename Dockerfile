# Build stage
FROM node:20-slim AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --only=production

# Production stage
FROM node:20-slim
WORKDIR /app

# Create non-root user
RUN groupadd -r nodeapp && \
    useradd -r -g nodeapp -s /bin/false nodeapp && \
    chown -R nodeapp:nodeapp /app

# Copy built node_modules and app files
COPY --from=builder /build/node_modules ./node_modules
COPY --chown=nodeapp:nodeapp . .

# Set resource limits - reduce from 512MB to 256MB
ENV NODE_OPTIONS="--max-old-space-size=256"

# Add memory monitoring
ENV NODE_OPTIONS="${NODE_OPTIONS} --heapsnapshot-near-heap-limit=3"

# Add garbage collection options
ENV NODE_OPTIONS="${NODE_OPTIONS} --expose-gc"

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { \
        console.log('Health check status:', r.statusCode); \
        process.exit(r.statusCode === 200 ? 0 : 1); \
    }).on('error', (e) => { \
        console.error('Health check error:', e); \
        process.exit(1); \
    })"

# Switch to non-root user
USER nodeapp

# Expose WebSocket port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"] 