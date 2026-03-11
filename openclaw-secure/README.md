# OpenClaw Secure

Hardened OpenClaw Docker image with security patches for known CVEs.

## Security Fixes

### CVE-2026-25253 (CVSS 9.1)
**Token Exfiltration via gatewayUrl Auto-Connect**

Fix: Gateway URL allowlisting. Only trusted gateway URLs are allowed.

### CVE-2026-24763 (CVSS 8.8)
**Docker Sandbox Command Injection via PATH**

Fix: PATH sanitization. Only standard system paths are allowed.

### CVE-2026-25157 (CVSS 8.1)
**SSH Mode Command Injection**

Fix: SSH mode completely disabled for managed deployments.

### Docker Build-Time Patches

**patch-docker-device-local.js**

Docker-Bridge-IPs (172.16–172.31) werden als „local“ für Device-Pairing erkannt. Das Browser-Tool verbindet aus dem Container (z.B. 172.18.0.2) – ohne diesen Patch wäre manuelle Pairing-Genehmigung nötig.

**patch-docker-pairing-silent.js**

Erstes Device-Pairing („not-paired“) für Browser-Tool wird silent auto-approved. Keine User-Interaktion nötig – Browser-Tool funktioniert direkt nach Start.

*Beide Patches werden im Docker-Build nach `npm install openclaw` angewendet.*

## Additional Hardening

- Non-root user execution
- Read-only filesystem
- Capability dropping (--cap-drop=ALL)
- Resource limits (2GB RAM, 1 CPU)
- Process limits (100 max)
- Network isolation
- Tmpfs for /tmp (noexec, nosuid)

## Build

```bash
chmod +x build.sh
./build.sh
```

### Docker Browser / Pairing

Browser-Tool und in-Container-Clients benötigen Pairing. Im Docker-Netzwerk werden 172.x.x.x nicht als „local“ gewertet. Die Deployment-Config setzt bereits `gateway.localNetworks` (PR [#18441](https://github.com/openclaw/openclaw/pull/18441)). Sobald der PR gemerged ist, funktioniert Auto-Pairing ohne Patches.

**Frühtest mit PR-Branch:**
```bash
docker build -f openclaw-secure/Dockerfile \
  --build-arg OPENCLAW_VERSION=github:openclaw/openclaw#feat/docker-local-pairing \
  -t openclaw-secure:pr18441 .
```

**Patch-Verifizierung (nach Build):**
```bash
docker run --rm --entrypoint sh openclaw-secure:latest -c 'grep -l OPENCLAW_GATEWAY_BIND /usr/local/lib/node_modules/openclaw/dist/*.js'
# Sollte mindestens eine Datei ausgeben (ws-CPpn8hzq.js oder chrome-*)
```

**Bei "pairing required" (Browser-Tool):** Container muss `OPENCLAW_GATEWAY_BIND=lan` gesetzt haben. Agenix setzt das automatisch. Alternativ: `openclaw devices approve` manuell im Container ausführen.

## Usage

```bash
docker run -d \
  --name openclaw-agent \
  -p 18789:18789 \
  -v /path/to/workspace:/root/.openclaw \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  openclaw-secure:latest
```

## Verification

Check that security patches are applied:

```bash
docker exec openclaw-agent node -e "console.log(process.env.PATH)"
# Should only show: /usr/local/bin:/usr/bin:/bin
```

## License

MIT
