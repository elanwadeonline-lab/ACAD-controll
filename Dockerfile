FROM oven/bun:1.1-slim

WORKDIR /app

# Copy package descriptors
COPY backend/package.json ./

# Install production dependencies
RUN bun install --production

# Copy backend source code
COPY backend/src/ ./src/

# Expose Render PORT
ENV PORT=8002
ENV NODE_ENV=production
EXPOSE 8002

# Start supervisory control plane server
CMD ["bun", "src/server.ts"]
