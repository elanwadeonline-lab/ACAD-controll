FROM oven/bun:1.1-slim

WORKDIR /app

# Copy package descriptors
COPY package.json ./

# Install production dependencies
RUN bun install --production

# Copy source code
COPY src/ ./src/

# Expose Render PORT
ENV PORT=8002
ENV NODE_ENV=production
EXPOSE 8002

# Start server
CMD ["bun", "src/server.ts"]
