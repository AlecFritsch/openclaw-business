# Open-Source Migration: ai-agency → openclaw-business

Plan for turning this into a public repo under the name **openclaw-business**.

> **Status:** Code cleanup done. Next step: Fresh repo or orphan branch (see below).

---

## 1. New repo (without old commits)

**Approach:**
```bash
# Option A: Fresh init (recommended)
mkdir openclaw-business && cd openclaw-business
git init
# Then copy cleaned code (see below)

# Option B: Squash all commits
git checkout --orphan open-source
git add -A
git commit -m "Initial open-source release: openclaw-business"
git branch -D main
git branch -m main
# Then push to new repo
```

**Important:** Old branches, tags, and history will not be carried over. All sensitive data from history is gone.

---

## 2. Secrets & sensitive files to remove

### Delete immediately (or add to .gitignore and never commit):
| File | Contains |
|------|----------|
| `.cursor/mcp.json` | MongoDB URI, Stripe secret, GitHub PAT |
| `.kiro/settings/mcp.json` | MongoDB URI, Stripe secret, GitHub PAT, Context7 key |
| `backend/.env` | MONGODB_URI, CLERK_*, STRIPE_*, etc. |
| `deploy/.env` | Production secrets |
| `frontend/.env.local` | If present |

### Replace with placeholders/templates:
- `.env.example` with all required keys (no values)
- `.cursor/mcp.json.example` or keep in .gitignore
- `.kiro/` optionally ignore entirely (internal AI config)

### Add to .gitignore:
```gitignore
# Sensitive / local
.cursor/mcp.json
.kiro/
deploy/.env
backend/.env
frontend/.env.local
*.env.local
```

---

## 3. Rename: agenix/Havoc → openclaw-business

### Package names (pnpm workspaces):
| Old | New |
|-----|-----|
| `agenix-monorepo` | `openclaw-business` |
| `@agenix/frontend` | `@openclaw-business/frontend` |
| `@agenix/backend` | `@openclaw-business/backend` |
| `@agenix/shared` | `@openclaw-business/shared` |

**Files:** `package.json` (root, frontend, backend, shared), `pnpm-workspace.yaml`

### Code references:
- `@agenix/shared` → `@openclaw-business/shared` (all imports)
- `Agenix` / `agenix` → `OpenClaw Business` / `openclaw-business` (comments, copy)
- `Havoc` / `usehavoc.com` → placeholders:
  - `YOUR_APP_NAME`
  - `https://your-domain.com`
  - `support@your-domain.com`, `hello@...`, `legal@...`, `privacy@...`

### Database fallback:
- `database.ts`: fallback `'agenix'` → `'openclaw_business'` (or `'openclaw-business'`)

---

## 4. Content to remove

### Plugins (Havoc-specific, optionally keep):
- `openclaw-secure/plugins/havoc-superchat` – Superchat integration
- `openclaw-secure/plugins/havoc-knowledge` – RAG
- `openclaw-secure/plugins/havoc-mcp` – Smithery MCP via backend

**Recommendation:** Either rename generically (e.g. `superchat`, `knowledge-base`, `mcp-connect`) with backend URL placeholders, or keep as example plugins with clear docs.

### Internal/private config:
- `.kiro/` – remove or add to .gitignore
- `.cursor/rules/infrastructure.mdc` – adjust (no GCP details, no usehavoc domains)
- `deploy/nginx.conf` – use placeholders (`your-domain.com` instead of `usehavoc.com`)
- `deploy/*.sh` – domains/hostnames as placeholders

### Domains & URLs (replace everywhere):
- `usehavoc.com` → placeholder
- `api.usehavoc.com`, `portal.usehavoc.com`, `admin.usehavoc.com`
- `clerk.usehavoc.com`, `accounts.usehavoc.com`
- `hello@usehavoc.com`, `support@usehavoc.com`, `legal@usehavoc.com`, `privacy@usehavoc.com`

### MongoDB:
- No concrete Atlas cluster names or URIs
- Only `.env.example` with `MONGODB_URI=`

### Other areas:
- UCareCDN logo URLs (replace with placeholders or public assets)
- `backend/data/curated-integrations.json` – "Havoc curated" → neutral
- Admin route: `admin.usehavoc.com` → placeholder

---

## 5. What stays / gets updated

### Keep:
- OpenClaw fork: clone separately (not in repo), pass `OPENCLAW_FORK_URL` when building
- Architecture (Next.js, Fastify, MongoDB, Docker)
- Clerk, Stripe, Smithery – as configurable services only (no concrete keys/URIs)
- All core features (Agents, Channels, Billing, etc.)

### Update:
- README: Havoc → openclaw-business, generic description
- License: Add LICENSE file (e.g. MIT)
- CONTRIBUTING.md for open-source contributions
- README with setup, no production-specific details

---

## 6. Checklist (order)

- [ ] **Backup:** Back up current repo
- [ ] **Check secrets:** `git log -p` for leaked keys (or use fresh repo)
- [ ] **New repo:** Create `openclaw-business` on GitHub
- [ ] **.gitignore:** Add secret files
- [ ] **Remove secrets:** mcp.json, .kiro, .env from repo
- [ ] **.env.example:** Create with all required variables (no values)
- [ ] **Package names:** @agenix → @openclaw-business
- [ ] **Strings:** Havoc, Agenix, usehavoc → placeholders
- [ ] **Domains:** usehavoc.com → your-domain.com / placeholder
- [ ] **Plugins:** Rename havoc-* or document
- [x] **openclaw-fork:** Removed from repo; clone separately, `OPENCLAW_FORK_URL` at build
- [ ] **README:** Rewrite for openclaw-business
- [ ] **LICENSE:** Add (e.g. MIT)
- [ ] **Fresh push:** Push only cleaned code

---

## 7. Effort estimate

| Task | Effort |
|------|--------|
| Remove secrets, .gitignore | ~30 min |
| Package rename + imports | ~1–2 hrs |
| String replacements (Havoc, URLs) | ~1–2 hrs |
| nginx.conf, deploy scripts | ~30 min |
| README, LICENSE, .env.example | ~1 hr |
| Tests + manual check | ~1–2 hrs |

**Total:** Roughly 1–2 days for a clean migration.
