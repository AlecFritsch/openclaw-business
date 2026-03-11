# Hardened OpenClaw Dockerfile (SaaS fork)
# Clones OpenClaw fork with Docker/SaaS changes (device-local, pairing-silent, ws:// private IPs).
#
# Build: docker build -f openclaw-secure/Dockerfile --build-arg OPENCLAW_FORK_URL=https://github.com/YOUR_ORG/openclaw-saas-fork.git -t openclaw-secure .
#
# Publish your OpenClaw fork (with SaaS changes) and pass OPENCLAW_FORK_URL at build time.

FROM node:22-slim

# Build tools for native addons (sharp, node-pty)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    cmake \
    make \
    g++ \
    python3 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Secure PATH (CVE-2026-24763 fix)
ENV PATH=/usr/local/bin:/usr/bin:/bin
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true

# SaaS: Gmail watcher, Canvas unused (platform uses own chat)
ENV OPENCLAW_SKIP_CANVAS_HOST=1
ENV OPENCLAW_SKIP_GMAIL_WATCHER=1

# Corepack for pnpm
RUN corepack enable pnpm

# Clone OpenClaw fork (must provide OPENCLAW_FORK_URL with SaaS-specific changes)
ARG OPENCLAW_FORK_URL
RUN test -n "$OPENCLAW_FORK_URL" || (echo "Build-arg OPENCLAW_FORK_URL required. Example: --build-arg OPENCLAW_FORK_URL=https://github.com/org/openclaw-saas-fork.git" && exit 1)
RUN git clone --depth 1 "$OPENCLAW_FORK_URL" /tmp/openclaw

WORKDIR /tmp/openclaw
# Slim build: docs/apps/ui removed in fork. CI=1 avoids pnpm TTY prompt in Docker.
ENV CI=1
RUN pnpm install && pnpm build
# Production deps only (saves ~150MB)
RUN rm -rf node_modules && pnpm install --prod --frozen-lockfile

# Keep built package at /opt/openclaw (reliable vs npm install -g which can fail in slim)
RUN mv /tmp/openclaw /opt/openclaw && chown -R node:node /opt/openclaw

# Install Lobster CLI (workflow runtime)
RUN npm install -g @clawdbot/lobster@latest

# Install ClawHub CLI for skill installs
RUN npm install -g clawhub

# Record version
RUN node /opt/openclaw/openclaw.mjs --version > /opt/openclaw-version 2>/dev/null || echo "fork-$(date +%Y%m%d)" > /opt/openclaw-version

# Remove build tools
RUN apt-get purge -y cmake make g++ python3 && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

# ── Chromium for in-container browser automation ──────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    python3-minimal \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium

# ── User + dirs ───────────────────────────────────────────────────
RUN mkdir -p /home/node/.openclaw/workspace \
             /home/node/.openclaw/agents/main/agent \
             /home/node/.openclaw/credentials && \
    chown -R node:node /home/node && \
    chmod 711 /home/node && \
    chmod 700 /home/node/.openclaw

COPY openclaw-secure/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Havoc Superchat plugin
COPY openclaw-secure/plugins/havoc-superchat /opt/havoc-superchat

# Havoc Knowledge plugin (org-scoped RAG search)
COPY openclaw-secure/plugins/havoc-knowledge /opt/havoc-knowledge

# Havoc MCP plugin (Smithery Connect — Intercom, Slack, GitHub, Notion, etc.)
COPY openclaw-secure/plugins/havoc-mcp /opt/havoc-mcp

USER node
WORKDIR /home/node

EXPOSE 18789

HEALTHCHECK --interval=60s --timeout=15s --start-period=180s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:18789/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)).setTimeout(10000,function(){this.destroy();process.exit(1)})" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/opt/openclaw/openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan", "--port", "18789"]
