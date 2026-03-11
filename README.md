<div align="center">

# OpenClaw Business

**AI agents that actually work.**

Describe your business problem → get a fully deployed agent with automations in under 60 seconds.

---

`Next.js 15` · `Fastify 5` · `MongoDB` · `OpenClaw` · `Docker` · `TypeScript`

---

**Live example:** [usehavoc.com](https://usehavoc.com) — AI employees for WhatsApp, Slack, Telegram and more.

</div>

> **Maintainers wanted.** This project is no longer actively maintained by its original author. Anyone interested in maintaining, developing, or hosting it is welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and how to get involved.

## What is OpenClaw Business?

OpenClaw Business is a managed AI agent platform. Users describe what they need in plain language — the AI Architect designs, configures, and deploys a production-ready agent with scheduled tasks, channel integrations, and tool access. No forms, no config dashboards. Everything is chat-driven.

Each agent runs in an isolated Docker container powered by [OpenClaw](https://docs.openclaw.ai), with its own gateway, tools, memory, and channel connections.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Nginx (TLS)                                  │
│  ├── your-domain.com     → Next.js 15 (3000)  │
│  └── api.your-domain.com → Fastify 5 (8080)  │
└──────────────┬───────────────────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐   Docker containers
│Agent 1│ │Agent 2│ │Agent N│   1 agent = 1 container
│OpenClaw│ │OpenClaw│ │OpenClaw│   WS + HTTP gateway
└───────┘ └───────┘ └───────┘
               │
     MongoDB · Clerk · Stripe
```

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 15, React 19, Tailwind, Clerk, Zustand |
| **Backend** | Fastify 5, MongoDB, Dockerode, Stripe |
| **Agents** | OpenClaw in Docker (hardened image) |
| **Shared** | TypeScript types + Zod schemas |

## Quick Start

```bash
pnpm install
cp .env.example .env    # Edit with your keys
pnpm build
pnpm dev
```

See [.env.example](.env.example) for required variables (MongoDB, Clerk, etc.).

## Building the Agent Docker Image

The `openclaw-secure` image requires an OpenClaw fork with SaaS/Docker changes (device-local IPs, pairing-silent, etc.). Publish your fork and build with:

```bash
export OPENCLAW_FORK_URL=https://github.com/YOUR_ORG/openclaw-saas-fork.git
cd openclaw-secure && ./build.sh
```

Or add `OPENCLAW_FORK_URL` to `backend/.env` before running `deploy/update-all.sh`.

## Project Structure

```
openclaw-business/
├── backend/         Fastify API
├── frontend/        Next.js app
├── shared/          Types + Zod
├── openclaw-secure/ Docker image for agents
└── deploy/          Nginx + PM2 scripts
```

## License

MIT — see [LICENSE](LICENSE).
