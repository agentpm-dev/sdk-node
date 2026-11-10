# App scaffold for supported Linux x86-64 (glibc).
# Supply a checksum-verified CLI 0.1.43+ binary named agentpm in the build context.
# The app package.json must require @agentpm/sdk ^0.1.17 or newer.
FROM node:22-trixie-slim AS node_runtime
FROM python:3.13-slim-trixie AS runtime

# Merge Node into the matching Python base, keeping Python's shared libraries.
COPY --from=node_runtime /usr/local /usr/local
ENV AGENTPM_PYTHON=/usr/local/bin/python3.13
COPY --chmod=755 agentpm /usr/local/bin/agentpm
RUN npm install --global pnpm@10.15.0
RUN useradd -m app
USER app
WORKDIR /app

COPY --chown=app:app package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=app:app . .
# Commit a portable agent.lock; provision for the image's target/interpreter.
# Installed-Agent apps: replace install below with an exact package install.
# CLI 0.1.43 direct non-Tool installs do not support --frozen; see the README.
RUN agentpm --version && agentpm install --frozen
CMD ["node", "dist/index.js"]
