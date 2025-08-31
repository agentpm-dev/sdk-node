# ---- Stage 1: vendor Python 3.11 from a matching distro --------------------
# Match the Debian family of your Node image to avoid libc/ssl mismatches.
FROM python:3.11-slim-bullseye AS python311

# ---- Stage 2: Node runtime with vendored Python ----------------------------
FROM node:22-bullseye AS runtime

# enable pnpm as root (writes to /usr/local/bin)
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Bring Python runtime into /opt/python (bin, libs, stdlib, pip)
COPY --from=python311 /usr/local /opt/python

# Make vendored Python visible on PATH and tell AgentPM to use it for Python tools
ENV PATH="/opt/python/bin:${PATH}"
ENV AGENTPM_PYTHON=/opt/python/bin/python3.11

# Create non-root user
RUN useradd -m app
USER app
WORKDIR /app

# (Optional) bake pre-installed AgentPM tools (created by `agentpm install` in this repo)
# If present locally, they’ll be copied into the image:
COPY --chown=app:app .agentpm /app/.agentpm

# copy metadata + lockfile first
COPY --chown=app:app package.json pnpm-lock.yaml ./

# copy the SDK tarball into the image (because it's a file dep)
COPY --chown=app:app vendor/agentpm-sdk-*.tgz ./vendor/

# install deps as the app user
RUN pnpm install --frozen-lockfile

# Copy the rest of your app
COPY --chown=app:app . .

# Helpful diagnostics during bring-up
ENV AGENTPM_DEBUG=0
# Optional hard overrides (usually not needed since both are on PATH)
# ENV AGENTPM_NODE=/usr/local/bin/node
# ENV AGENTPM_PYTHON=/opt/python/bin/python3.11

CMD ["node", "dist/index.js"]
