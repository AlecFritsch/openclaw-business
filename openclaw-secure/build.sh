#!/bin/bash
# Build hardened OpenClaw Docker image
#
# Usage:
#   OPENCLAW_FORK_URL=https://github.com/org/openclaw-saas-fork.git ./build.sh
#   OPENCLAW_FORK_URL=... ./build.sh 1.2.3   # Pin version tag
#
# OPENCLAW_FORK_URL is required (OpenClaw fork with SaaS/Docker changes).
#
# Image tags: openclaw-secure:<version>, openclaw-secure:latest

set -e

VERSION=${1:-latest}
FORK_URL="${OPENCLAW_FORK_URL:-}"

if [ -z "$FORK_URL" ]; then
  echo "Error: OPENCLAW_FORK_URL must be set (OpenClaw fork with SaaS changes)"
  echo "Example: OPENCLAW_FORK_URL=https://github.com/org/openclaw-saas-fork.git ./build.sh"
  exit 1
fi

echo "========================================="
echo " Building openclaw-secure image"
echo " Fork: ${FORK_URL}"
echo "========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

docker build \
  -f openclaw-secure/Dockerfile \
  --build-arg OPENCLAW_FORK_URL="${FORK_URL}" \
  -t "openclaw-secure:${VERSION}" \
  -t openclaw-secure:latest \
  .

# Show the installed version from the image
INSTALLED=$(docker run --rm --entrypoint cat openclaw-secure:${VERSION} /opt/openclaw-version 2>/dev/null || echo "unknown")

echo ""
echo "========================================="
echo " Build complete!"
echo " Image tags:"
echo "   openclaw-secure:${VERSION}"
echo "   openclaw-secure:latest"
echo " Installed OpenClaw: ${INSTALLED}"
echo "========================================="
echo ""
echo "Security features (in fork):"
echo "  - Device-local + pairing-silent (Docker 172.x)"
echo "  - ws:// RFC1918 + OPENCLAW_GATEWAY_URL"
echo "  - PATH sanitization (Dockerfile ENV)"
echo "  - Non-root user (uid 1000, node)"
echo "  - Capability dropping"
echo "  - Resource limits"
echo ""
echo "Bundled tools:"
echo "  - Chromium (headless browser automation)"
echo "  - Lobster CLI (workflow runtime)"
echo ""
echo "To deploy: set OPENCLAW_IMAGE_TAG=openclaw-secure:${VERSION} in .env"
