# One image, one process: the built scene and the presence server share an
# origin, so there is no CORS to configure, no second domain, and no socket
# URL to bake into the client.

FROM node:22-alpine AS build
WORKDIR /app
# Dependencies first, so a source-only change reuses the cached install layer.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_SOCKET_URL is deliberately left unset: the client then talks to
# whatever origin serves it, which is this image.
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=build /app/dist ./public

ENV PORT=3000 STATIC_DIR=/app/public
EXPOSE 3000
# Node handles SIGTERM itself here (see index.js), so no init shim is needed
# for a clean redeploy.
CMD ["node", "src/index.js"]
