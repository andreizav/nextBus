# Stage 1: Build Angular 20 UI widget
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Node.js + TypeScript Backend & MCP Server
FROM node:22-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Production Runtime Image for Railway
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=frontend-builder /app/frontend/dist/frontend/browser ./frontend/dist/frontend/browser
COPY docs ./docs

EXPOSE 3000
CMD ["node", "backend/dist/index.js"]
