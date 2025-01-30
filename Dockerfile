# Stage 1: Build everything (server + worker)
FROM node:18-alpine AS builder
WORKDIR /usr/src/app

# Install Git (needed for Vite or other scripts)
RUN apk add --no-cache git

# Copy npm settings first
COPY .npmrc ./

# Copy package.json separately for better caching
COPY package.json package-lock.json ./
RUN npm install --omit=dev=false && npm cache clean --force

# Copy the full repo and build **everything**
COPY . .
# builds dist/server, dist/worker, dist/app, dist/shared, etc.
RUN npm run build

# Stage 2: Production (Base Runtime)
FROM node:18-alpine AS runtime
WORKDIR /usr/src/app

# Copy only runtime dependencies
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy all built files from builder
COPY --from=builder /usr/src/app/dist /usr/src/app/dist
COPY --from=builder /usr/src/app/node_modules /usr/src/app/node_modules

# Stage 3: Production (Server)
FROM runtime AS server
EXPOSE 80
CMD ["node", "dist/server/server.js", "--port=80"]

# Stage 4: Production (Worker)
FROM runtime AS worker

# Set default SERVER_URL to point to the server service
ENV SERVER_URL="http://server:80"

# Run the worker service with the correct server URL
CMD ["node", "dist/server/agency.js", "-d", "$$INTERNAL_SERVICE_TOKEN", "$$SERVER_URL"]
