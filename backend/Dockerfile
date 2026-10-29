# Backend Dockerfile - Multi-stage Production Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install native build tools for compiling better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci --legacy-peer-deps

COPY src ./src
RUN npm run build

# Stage 2: Minimal Production Runtime
FROM node:20-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

RUN mkdir -p /app/data && chown -R app:app /app

USER app

EXPOSE 3002

CMD ["node", "dist/index.js"]
