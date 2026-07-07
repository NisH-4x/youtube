# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: install deps and produce the Next.js standalone server bundle.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so they must be present during
# `npm run build`. Render (and `docker build --build-arg`) supply them here.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage: a small image with Node + ffmpeg + yt-dlp on PATH.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# System dependencies:
#   ffmpeg      — merges video+audio and extracts audio (installed via apt)
#   yt-dlp_linux — the STANDALONE PyInstaller binary that bundles its own Python.
#                  (The plain "yt-dlp" asset is a Python zipapp that needs a
#                  system python3, which this slim image doesn't have — using it
#                  fails at runtime with "/usr/bin/env: 'python3': No such file".)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Run as the non-root user that the node image already provides.
USER node

# Copy the standalone server, static assets, and public files.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

EXPOSE 3000

# Sanity self-check on boot: log the resolved binary versions (non-fatal).
CMD ["node", "server.js"]
