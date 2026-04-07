# Dockerfile for Flagmint SDK Tester
# Base image: node:24-bookworm-slim

# Development stage
FROM node:24-bookworm-slim AS development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Expose Vite dev server port
EXPOSE 5173

# Run development server (disable auto-open since there's no browser in container)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--open", "false"]


# Build stage
FROM node:24-bookworm-slim AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application files
COPY . .

# Build the application
RUN npm run build


# Production stage
FROM node:24-bookworm-slim AS production

WORKDIR /app

# Install serve to serve static files
RUN npm install -g serve

# Copy built files from build stage
COPY --from=build /app/dist ./dist

# Expose port for production server
EXPOSE 3000

# Serve the built application
CMD ["serve", "-s", "dist", "-l", "3000"]
