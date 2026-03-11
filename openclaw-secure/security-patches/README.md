# Security Patches — alle nativ im Fork

All former build-time and runtime patches are now implemented natively in the **OpenClaw fork** (clone separately):

| Ehemaliger Patch | Native Umsetzung im Fork |
|------------------|---------------------------|
| **device-local** | `net.ts`: `isLoopbackAddress` behandelt 172.16–31 als lokal wenn `OPENCLAW_GATEWAY_BIND=lan` |
| **pairing-silent** | `message-handler.ts`: `silent: (reason === "not-paired" \|\| "scope-upgrade" \|\| "role-upgrade")` |
| **lan-ws** | `net.ts`: `isSecureWebSocketUrl` erlaubt ws:// zu RFC1918/CGNAT; `call.ts`: `OPENCLAW_GATEWAY_URL` Env-Override |
| **CVE-2026-25253** | `call.ts` + `client.ts`: `isSecureWebSocketUrl`, `buildGatewayConnectionDetails` blockiert unsichere URLs |
| **CVE-2026-24763** | Dockerfile: `ENV PATH=/usr/local/bin:/usr/bin:/bin` |
| **CVE-2026-25157** | No longer relevant (SSH/config structure changed) |

No build-time patches required anymore. The Dockerfile starts the gateway directly without `-r patches.js`.
