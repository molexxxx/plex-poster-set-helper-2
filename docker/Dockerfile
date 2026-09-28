# syntax=docker/dockerfile:1
#
# Plex Poster Helper - native web UI served in the browser.
#
#   http://<host>:3939  - full app in your browser
#
#   docker build -f docker/Dockerfile -t plex-poster-helper-2 .

# ----- Build stage -------------------------------------------------------------
FROM node:22-bookworm AS build
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build:web

# Bundle the Chromium headless shell so the container never downloads it at runtime.
RUN npm run prepare:browser

RUN npm prune --omit=dev

# ----- Runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 libgtk-3-0 libxshmfence1 \
      libsecret-1-0 fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=build /build /app
WORKDIR /app

ENV PLEX_HELPER_WEB=1 \
    PLEX_HELPER_PROD=1 \
    PLEX_HELPER_DOCKER=1 \
    PLEX_HELPER_CONFIG_DIR=/config/app \
    PLEX_BROWSER_BUNDLED_DIR=/app/resources/browsers \
    PORT=3939

VOLUME /config
EXPOSE 3939

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/server/index.js"]
