FROM node:20-alpine AS build
WORKDIR /app

# Install backend dependencies first for better layer caching.
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend

# Build backend TypeScript.
COPY backend ./backend
RUN npm run build --prefix backend
RUN npm prune --omit=dev --prefix backend

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/backend/package*.json ./backend/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/env-preload.mjs ./backend/env-preload.mjs

EXPOSE 4000
CMD ["node", "--import", "./backend/env-preload.mjs", "backend/dist/server.js"]
