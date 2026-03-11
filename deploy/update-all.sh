#!/bin/bash
# Full Deploy Update — Backend + Frontend + Nginx
# Run from project root on the GCP VM
set -e

echo "=== OpenClaw Business Full Deploy Update ==="

# Pull latest code
echo "[1/10] Pulling latest code..."
git pull

# Install deps
echo "[2/10] Installing dependencies..."
pnpm install

# Build shared types (must be first)
echo "[3/10] Building shared types..."
pnpm build:shared

# Build OpenClaw secure image (requires OPENCLAW_FORK_URL in env or .env)
echo "[4/10] Building OpenClaw secure image..."
if [ -z "${OPENCLAW_FORK_URL:-}" ] && [ -f backend/.env ]; then
  export OPENCLAW_FORK_URL="$(grep -E '^OPENCLAW_FORK_URL=' backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi
if [ -z "${OPENCLAW_FORK_URL:-}" ]; then
  echo "  Skipping (set OPENCLAW_FORK_URL to build)"
else
  (cd openclaw-secure && ./build.sh)
fi

# Build backend
echo "[5/10] Building backend..."
pnpm build:backend

# Build frontend
echo "[6/10] Building frontend..."
cd frontend
BACKEND_INTERNAL_URL=http://localhost:8080 \
npx next build
cd ..

# Update Nginx config if changed
echo "[7/10] Updating Nginx config..."
NGINX_SITE="${NGINX_SITE:-your-domain.com}"
if ! diff -q deploy/nginx.conf /etc/nginx/sites-available/$NGINX_SITE > /dev/null 2>&1; then
  sudo cp deploy/nginx.conf /etc/nginx/sites-available/$NGINX_SITE
  sudo ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  echo "  Nginx config updated and reloaded"
else
  echo "  Nginx config unchanged, skipping"
fi

# Fix openclaw-data permissions (container runs as backend user)
echo "[8/10] Fixing openclaw-data permissions..."
if [ -f backend/.env ]; then
  OPENCLAW_DIR="$(grep -E '^OPENCLAW_WORKSPACE_DIR=' backend/.env | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/openclaw-data}"
if [ -d "$OPENCLAW_DIR" ]; then
  ME="$(id -u):$(id -g)"
  sudo chown -R "$ME" "$OPENCLAW_DIR" 2>/dev/null || sudo chmod -R g+rw "$OPENCLAW_DIR" 2>/dev/null || true
  echo "  Permissions set for $OPENCLAW_DIR"
fi

# Restart services
echo "[9/10] Restarting services..."
cd backend
pm2 restart openclaw-business-backend 2>/dev/null || pm2 start ecosystem.config.cjs
cd ..

# Start frontend if not running
pm2 describe openclaw-business-frontend > /dev/null 2>&1 || {
  cd frontend
  pm2 start "npx next start -p 3000" --name openclaw-business-frontend
  cd ..
}
pm2 restart openclaw-business-frontend 2>/dev/null || true

# Recreate OpenClaw agent containers so they use the new image (restart keeps old image)
echo "[10/10] Recreating OpenClaw agent containers..."
for cid in $(docker ps -a --filter "name=openclaw-" -q 2>/dev/null); do
  docker stop "$cid" 2>/dev/null || true
  docker rm "$cid" 2>/dev/null || true
done

pm2 save

echo ""
echo "=== Deploy complete ==="
echo "Backend:  pm2 logs openclaw-business-backend"
echo "Frontend: pm2 logs openclaw-business-frontend"
echo "Health:   curl http://localhost:8080/health"
echo "Site:     Set FRONTEND_URL in .env for your domain"
echo "API Docs: Set FRONTEND_URL/api/docs or BACKEND_URL/api/docs"
