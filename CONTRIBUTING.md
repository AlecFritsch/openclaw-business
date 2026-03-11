# Contributing to OpenClaw Business

This project is no longer actively maintained by its original author. Maintainers are welcome — fork, adapt, and run it yourself. Contributions, improvements, and adoption are appreciated.

## Setup

```bash
pnpm install
cp .env.example .env   # Add your keys (MongoDB, Clerk, etc.)
pnpm build
pnpm dev
```

## Project structure

- `backend/` — Fastify API, agent deployment, OpenClaw integration
- `frontend/` — Next.js app, Builder UI, dashboard
- `shared/` — TypeScript types + Zod schemas
- `openclaw-secure/` — Docker image for agent containers
- OpenClaw fork — clone separately, publish your fork; pass `OPENCLAW_FORK_URL` when building the Docker image

## Development

- `pnpm build:shared` — Build types first (required before backend/frontend)
- `pnpm dev:backend` — Backend with hot reload
- `pnpm dev:frontend` — Frontend with Turbopack
- `pnpm dev` — All services
- `pnpm lint` — Lint backend + frontend
- `pnpm typecheck` — TypeScript check

## Pull requests

1. Fork the repo
2. Create a feature branch
3. Ensure `pnpm build` and `pnpm lint` pass
4. Open a PR with a clear description

## Code style

- TypeScript strict mode
- Prefer explicit types over `any`
- Format with project defaults (Prettier/ESLint)
