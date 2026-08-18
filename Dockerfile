# syntax=docker/dockerfile:1.7
#
# CoC server image — runs `coc serve` with no clone, no local Node, no build.
#
#   docker run --network host -v coc-data:/data ghcr.io/plusplusoneplusplus/coc:latest
#   → http://127.0.0.1:4000
#
# Policy: the server binds 127.0.0.1 inside the container, never a wildcard address.
# Bridge port publishing (-p) cannot reach a loopback-bound process, so there is
# no EXPOSE. Single-box use is --network host; managed use is an auth sidecar
# sharing the container's network namespace (see deploy/tenant/).
#
# Stages:
#   build — runs on the BUILD platform (native speed): npm ci + `npm run build
#           -w packages/coc`. Output (dist/, SPA bundle) is arch-independent.
#   deps  — runs on the TARGET platform: `npm ci --omit=dev` so native addons
#           (better-sqlite3, node-pty) and the per-arch agent CLIs
#           (@github/copilot-linux-*, @openai/codex-linux-*) match the image arch.
#   final — slim runtime: build output + target-arch node_modules + git/gh/tini.
ARG NODE_VERSION=24

# ---------- build (native platform, arch-independent JS output) ----------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false
WORKDIR /src
# Layer-cache the install: lockfile + every workspace package.json first.
# Keep this list in sync with root package.json "workspaces"
# (guarded by packages/coc/test/docker/dockerfile-contract.test.ts).
COPY package.json package-lock.json ./
COPY packages/coc-memory/package.json      packages/coc-memory/
COPY packages/coc-agent-sdk/package.json   packages/coc-agent-sdk/
COPY packages/coc-workflow/package.json    packages/coc-workflow/
COPY packages/forge/package.json           packages/forge/
COPY packages/coc/package.json             packages/coc/
COPY packages/coc-client/package.json      packages/coc-client/
COPY packages/coc-desktop/package.json     packages/coc-desktop/
COPY packages/deep-wiki/package.json       packages/deep-wiki/
COPY packages/coccontainer/package.json    packages/coccontainer/
COPY packages/coc-connector/package.json   packages/coc-connector/
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
# .git is not in the build context; pass the commit in so /api/health reports it.
ARG BUILD_COMMIT=unknown
ENV COC_BUILD_COMMIT=${BUILD_COMMIT}
# prebuild builds the required sibling workspaces; no desktop/deep-wiki/container.
RUN npm run build -w packages/coc
# node_modules come from the target-arch `deps` stage, not from here.
RUN rm -rf node_modules && find packages -mindepth 2 -maxdepth 2 -name node_modules -type d -exec rm -rf {} +

# ---------- deps (target platform, production dependency tree) ----------
FROM node:${NODE_VERSION}-bookworm AS deps
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/coc-memory/package.json      packages/coc-memory/
COPY packages/coc-agent-sdk/package.json   packages/coc-agent-sdk/
COPY packages/coc-workflow/package.json    packages/coc-workflow/
COPY packages/forge/package.json           packages/forge/
COPY packages/coc/package.json             packages/coc/
COPY packages/coc-client/package.json      packages/coc-client/
COPY packages/coc-desktop/package.json     packages/coc-desktop/
COPY packages/deep-wiki/package.json       packages/deep-wiki/
COPY packages/coccontainer/package.json    packages/coccontainer/
COPY packages/coc-connector/package.json   packages/coc-connector/
# Production deps only; optional deps (agent CLI binaries, node-pty) are kept.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client tini curl \
 && rm -rf /var/lib/apt/lists/*
# gh is not in bookworm main — install the pinned release tarball for TARGETARCH.
ARG GH_VERSION=2.97.0
ARG GH_SHA256_AMD64=a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112
ARG GH_SHA256_ARM64=73ea440ecad9c9e284429997ee6f93577bc6f7bc6fba357ef62c53ad8fb641a5
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) sha="${GH_SHA256_AMD64}" ;; \
      arm64) sha="${GH_SHA256_ARM64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    tarball="gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    curl -fsSLo "/tmp/${tarball}" "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${tarball}"; \
    echo "${sha}  /tmp/${tarball}" | sha256sum -c -; \
    tar -xzf "/tmp/${tarball}" -C /usr/local --strip-components=1 "gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh"; \
    rm -f "/tmp/${tarball}"; \
    gh --version
WORKDIR /app
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/packages ./packages
COPY --from=deps  /src/node_modules ./node_modules
COPY --from=deps  /src/packages ./packages
COPY docker/entrypoint.sh /usr/local/bin/coc-entrypoint
# `coc` on PATH inside the container (docker exec … coc queue …; provisioner exec).
RUN ln -s /app/packages/coc/dist/index.js /usr/local/bin/coc \
 && chmod +x /usr/local/bin/coc-entrypoint /app/packages/coc/dist/index.js \
 && mkdir -p /data /work && chown -R node:node /data /work
USER node
# HOME on the volume so ~/.coc, ~/.copilot, ~/.claude, ~/.codex, ~/.gitconfig, ~/.ssh persist.
ENV HOME=/data \
    NODE_ENV=production
VOLUME ["/data"]
# No EXPOSE: the server is loopback-only; ingress is --network host or a same-netns sidecar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.COC_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tini forwards SIGTERM so `coc serve` drains its queue on `docker stop`.
ENTRYPOINT ["tini","--","coc-entrypoint"]
CMD ["--host","127.0.0.1","--port","4000","--data-dir","/data/.coc"]
