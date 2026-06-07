# syntax=docker/dockerfile:1
#
# Plex Poster Helper - browser-accessible GUI (KasmVNC).
# Open the full desktop app in a browser at http://<host>:3000.
#
#   docker build -f docker/Dockerfile -t plex-poster-helper:gui .

# ----- Build stage -------------------------------------------------------------
FROM node:22-bookworm AS build
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

# Skip Electron's own binary download (its postinstall is ESM-broken under Node
# 22); we fetch the matching binary explicitly below so it's baked into the image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# npm install (not ci): the committed lock is generated on Windows and lacks
# some Linux-only optional deps, which would make the strict `npm ci` fail.
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Fetch the matching Electron binary into node_modules/electron/dist
RUN set -eux; \
    EV="$(node -p "require('/build/node_modules/electron/package.json').version")"; \
    case "$(uname -m)" in x86_64) EA=x64;; aarch64|arm64) EA=arm64;; *) EA=x64;; esac; \
    curl -fsSL -o /tmp/electron.zip "https://github.com/electron/electron/releases/download/v${EV}/electron-v${EV}-linux-${EA}.zip"; \
    rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist; \
    unzip -q /tmp/electron.zip -d node_modules/electron/dist; \
    chmod +x node_modules/electron/dist/electron; \
    printf 'electron' > node_modules/electron/path.txt; \
    rm /tmp/electron.zip

COPY . .
RUN npm run build   # vite build (renderer → src/dist) + tsc (electron → electron/dist)

# Drop dev dependencies for a leaner runtime copy
RUN npm prune --omit=dev

# ----- Runtime: KasmVNC desktop ------------------------------------------------
FROM lscr.io/linuxserver/baseimage-kasmvnc:debianbookworm

# Shared libraries Electron + Playwright Chromium need to run
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 libgtk-3-0 libxshmfence1 \
      libsecret-1-0 fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Built app (renderer + compiled electron + pruned node_modules incl. electron)
COPY --from=build /build /app

# Autostart the GUI inside the VNC desktop
COPY docker/autostart /defaults/autostart
RUN chmod +x /defaults/autostart

# Default the KasmVNC stream to lossless quality (10 = lossless). The base copies
# this .lsio template to the active kasmvnc.yaml on every start; KasmVNC merges it
# over the defaults, so we only override the quality bounds.
RUN printf '\nencoding:\n  rect_encoding_mode:\n    min_quality: 10\n    max_quality: 10\n' \
      >> /usr/local/etc/kasmvnc/kasmvnc.yaml.lsio

# Persist config / logs / installed Chromium under the mounted /config volume,
# and behave correctly without a system tray.
ENV PLEX_HELPER_CONFIG_DIR=/config/app \
    PLEX_HELPER_NO_TRAY=1 \
    PLEX_HELPER_PROD=1 \
    PLEX_HELPER_DOCKER=1 \
    TITLE="Plex Poster Helper"

VOLUME /config
EXPOSE 3000 3001
