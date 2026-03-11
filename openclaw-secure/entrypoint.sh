#!/bin/bash
# entrypoint.sh — Validate config, install ClawHub skills, then start gateway
set -e

OPENCLAW_HOME="${HOME}/.openclaw"
OPENCLAW_CONFIG="${OPENCLAW_HOME}/openclaw.json"
WORKSPACE_DIR="${OPENCLAW_HOME}/workspace"

echo "[entrypoint] HOME=$HOME, config=$OPENCLAW_CONFIG"

if [ ! -f "$OPENCLAW_CONFIG" ]; then
  echo "[entrypoint] FATAL: $OPENCLAW_CONFIG not found"
  ls -la "$OPENCLAW_HOME" 2>/dev/null || echo "  (dir missing)"
  sleep 30
  exit 1
fi

# Install ClawHub skills from config before gateway starts.
# OpenClaw returns "Installer not found: clawhub:X" when skills.entries has ClawHub
# skills but the skill files don't exist. Pre-installing via clawhub CLI fixes this.
if command -v clawhub >/dev/null 2>&1; then
  SKILLS=$(OPENCLAW_CFG="$OPENCLAW_CONFIG" node -e '
    try {
      const c = JSON.parse(require("fs").readFileSync(process.env.OPENCLAW_CFG || "","utf8"));
      const e = c.skills && c.skills.entries;
      console.log(e ? Object.keys(e).join(" ") : "");
    } catch (e) { console.log(""); }
  ' 2>/dev/null || true)
  echo "[entrypoint] ClawHub skills to install: ${SKILLS:-<none>}"
  for slug in $SKILLS; do
    case "$slug" in
      ""|memory|browser) continue ;;
    esac
    echo "[entrypoint] Installing ClawHub skill: $slug"
    if CLAWHUB_WORKDIR="$WORKSPACE_DIR" clawhub install "$slug" --no-input --force 2>&1; then
      echo "[entrypoint] Installed: $slug"
    else
      echo "[entrypoint] Install failed (non-fatal): $slug"
    fi
  done
else
  echo "[entrypoint] clawhub CLI not found, skipping ClawHub skill pre-install"
fi

echo "[entrypoint] Tightening file permissions..."
chmod 600 "$OPENCLAW_CONFIG" 2>/dev/null || true
chmod 700 "$OPENCLAW_HOME/credentials" 2>/dev/null || true
find "$OPENCLAW_HOME/agents" -name "auth-profiles.json" -exec chmod 600 {} \; 2>/dev/null || true

echo "[entrypoint] Starting gateway..."
exec "$@"
