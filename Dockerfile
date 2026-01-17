# Multi-stage build for production
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy icon files (multiple sizes for different use cases)
COPY icon.png ./
COPY icon-64.png ./
COPY favicon-32.png ./

# Set environment
ENV NODE_ENV=production
ENV PORT=8080
ENV BUILD_TIMESTAMP=20260117-ga-fix-v4.5.21

# Google Analytics 4 (server-side tracking via Measurement Protocol)
# Shared measurement ID with Web App and iOS for unified analytics
ENV GA_MEASUREMENT_ID=G-HEZ2PWTFZE
ENV GA_API_SECRET=RGt5_wCNT1WXhROorv2NXA
ENV ENABLE_ANALYTICS=true

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "dist/server.js"]
