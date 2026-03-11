// Gateway WebSocket Client - Real-time communication with OpenClaw Gateways
// Implements the OpenClaw Gateway WS protocol for operator connections

import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { dockerService } from './docker.service.js';
import { getDatabase } from '../config/database.js';
import type {
  GatewayWSMessage,
  GatewaySession,
  GatewayMessage,
  ChannelType,
  CronJobConfig,
  MemorySearchResult,
} from '@openclaw-business/shared';

// ── Types ───────────────────────────────────────────────────────

export interface GatewayConnectionInfo {
  agentId: string;
  url: string;
  token: string;
}

export interface GatewayClientOptions {
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  requestTimeoutMs?: number;
}

/** Safely stringify a gateway error (which may be a string OR an object) */
function stringifyError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    // OpenClaw may send { code, message, ... } or { error: "..." }
    const obj = err as any;
    if (obj.message) return `${obj.code ? `[${obj.code}] ` : ''}${obj.message}`;
    if (obj.error) return typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error);
    return JSON.stringify(err);
  }
  return String(err);
}

// ── Single Gateway Connection ───────────────────────────────────

export class GatewayWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    method: string;
  }>();
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private lastPongAt = 0;
  /** Methods the gateway reported as unknown — skip these to avoid log spam */
  private unsupportedMethods = new Set<string>();

  /** Ed25519 device keypair for operator authentication (matches official GatewayClient) */
  private devicePrivateKey: crypto.KeyObject;
  private devicePublicKeyBase64Url: string;
  private deviceId: string;

  /** Cached device auth token from hello-ok (reused on reconnect) */
  private cachedDeviceToken: string | null = null;
  private deviceTokenFile: string;

  /** Tick watchdog: gateway sends tick events at this interval (ms) */
  private serverTickIntervalMs = 15_000;
  private lastTickAt = 0;
  private tickWatchTimer: NodeJS.Timeout | null = null;

  constructor(
    private connectionInfo: GatewayConnectionInfo,
    private options: GatewayClientOptions = {}
  ) {
    super();
    this.options = {
      reconnectIntervalMs: 2000, // Base delay (exponential backoff applied on top)
      maxReconnectAttempts: 50,  // Reasonable limit to prevent unbounded reconnection
      requestTimeoutMs: 30000,
      ...options,
    };

    // Start TTL cleanup for loginState (every 5 minutes, remove entries older than 10 minutes)
    setInterval(() => {
      const now = Date.now();
      const ttlMs = 10 * 60 * 1000; // 10 minutes
      for (const [key, entry] of this.loginState) {
        if (now - entry.updatedAt > ttlMs) {
          this.loginState.delete(key);
        }
      }
    }, 5 * 60 * 1000); // Run every 5 minutes

    // Device token persistence file
    this.deviceTokenFile = `/var/agenix/device-tokens/${connectionInfo.agentId}.json`;

    // Derive a DETERMINISTIC Ed25519 keypair from agentId + token.
    // Must be stable across restarts so the gateway recognizes the same device.
    // Ed25519 private key = 32-byte seed. We derive it via SHA-256.
    const seed = crypto.createHash('sha256')
      .update(`havoc-device:${connectionInfo.agentId}:${connectionInfo.token}`)
      .digest();

    // Build PKCS8 DER wrapper for Ed25519 seed (RFC 8410)
    // Header: 302e020100300506032b657004220420 (16 bytes) + 32-byte seed
    const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
    const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
    this.devicePrivateKey = crypto.createPrivateKey({
      key: pkcs8Der,
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = crypto.createPublicKey(this.devicePrivateKey);
    const pubSpki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    // OpenClaw SPKI DER prefix for Ed25519: 302a300506032b6570032100 (12 bytes)
    const ED25519_SPKI_PREFIX_LEN = 12;
    const rawPubKey = pubSpki.subarray(ED25519_SPKI_PREFIX_LEN);
    // OpenClaw uses base64url encoding for publicKey (NOT hex)
    this.devicePublicKeyBase64Url = rawPubKey.toString('base64')
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
    // device.id = SHA-256 hex fingerprint of the raw 32-byte public key
    this.deviceId = crypto.createHash('sha256').update(rawPubKey).digest('hex');

    // Load cached device token from disk
    this.loadDeviceToken();

    // Prevent unhandled 'error' from crashing — callers should use try/catch on connect/request
    this.on('error', () => {});
  }

  private loadDeviceToken(): void {
    try {
      if (existsSync(this.deviceTokenFile)) {
        const data = JSON.parse(readFileSync(this.deviceTokenFile, 'utf-8'));
        if (data.deviceToken && data.deviceId === this.deviceId) {
          this.cachedDeviceToken = data.deviceToken;
        }
      }
    } catch (err) {
      console.warn(`[gw-ws] Failed to load cached device token for ${this.connectionInfo.agentId}:`, (err as Error).message);
    }
  }

  private async saveDeviceToken(): Promise<void> {
    if (!this.cachedDeviceToken) return;
    try {
      const dir = path.dirname(this.deviceTokenFile);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.deviceTokenFile, JSON.stringify({
        deviceId: this.deviceId,
        deviceToken: this.cachedDeviceToken,
      }), 'utf-8');
      console.log(`[gw-ws] Saved device token to ${this.deviceTokenFile}`);
    } catch (err) {
      console.error(`[gw-ws] Failed to save device token:`, err);
    }
  }

  /**
   * Start WebSocket ping/pong keepalive (every 30s).
   * Detects dead connections and triggers reconnect.
   */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastPongAt = Date.now();
    this.lastTickAt = Date.now();
    
    // WS-level ping/pong keepalive
    this.keepaliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      
      // If no pong received within 60s, connection is dead
      if (Date.now() - this.lastPongAt > 60000) {
        console.warn(`[gw-ws] Dead connection detected for agent ${this.connectionInfo.agentId} (no pong for 60s)`);
        this.ws.terminate();
        return;
      }
      
      try {
        this.ws.ping();
      } catch {
        // ping failed — connection is broken
      }
    }, 30000);

    // Tick watchdog: Gateway sends "tick" events at serverTickIntervalMs.
    // If we don't receive a tick within 2x the interval, the connection is stale.
    // (Mirrors the official GatewayClient.startTickWatch)
    this.tickWatchTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (!this.lastTickAt) return;
      const gap = Date.now() - this.lastTickAt;
      if (gap > this.serverTickIntervalMs * 2.5) {
        console.warn(`[gw-ws] Tick timeout for agent ${this.connectionInfo.agentId} (${Math.round(gap / 1000)}s since last tick, expected every ${this.serverTickIntervalMs / 1000}s)`);
        this.ws.close(4000, 'tick timeout');
      }
    }, Math.max(this.serverTickIntervalMs, 5000));
  }
  
  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.tickWatchTimer) {
      clearInterval(this.tickWatchTimer);
      this.tickWatchTimer = null;
    }
  }

  // ── Connection Lifecycle ────────────────────────────────────

  /**
   * Connect to the gateway with automatic device pairing retry.
   * On first connect to a new container, device pairing is required.
   * The gateway sees our Docker bridge IP as non-local, so auto-approve
   * doesn't kick in. We handle this by running `openclaw devices approve`
   * inside the container via docker exec, then retrying the connection.
   */
  async connect(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.doConnect();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isPairingError = msg.includes('PAIRING_REQUIRED') || msg.includes('NOT_PAIRED') || msg.includes('pairing required');
        if (isPairingError && attempt < 2) {
          const requestIdMatch = msg.match(/PAIRING_REQUIRED:([0-9a-f-]{36})/i);
          const requestId = requestIdMatch?.[1] || '';
          console.log(`[gw-ws] Pairing required — writing paired.json (attempt ${attempt + 1}/3) for agent ${this.connectionInfo.agentId}`);
          // Clear stale device token — gateway will issue a new one after re-pairing
          this.cachedDeviceToken = null;
          await this.autoApproveViaDocker(requestId);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Device pairing auto-approve failed after 3 attempts (agent ${this.connectionInfo.agentId})`);
  }

  private async doConnect(): Promise<void> {
    // Clean up any stale WS from a previous attempt
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      try {
        // Include X-Forwarded-For: 127.0.0.1 so the gateway treats us as a local
        // connection. Docker bridge networking makes our IP 172.x.x.x which the
        // gateway sees as non-local (requiring device pairing + challenge signing).
        // Since 172.0.0.0/8 is in gateway.trustedProxies, the gateway trusts the
        // forwarded header and auto-approves device pairing + grants full scopes.
        this.ws = new WebSocket(this.connectionInfo.url, {
          // Match official GatewayClient maxPayload (25 MiB) for large canvas/node responses
          maxPayload: 25 * 1024 * 1024,
          headers: {
            'X-Forwarded-For': '127.0.0.1',
            'X-Real-IP': '127.0.0.1',
          },
        });
        let connectResolved = false;
        let connectId = '';

        // Hard timeout for the entire connect handshake (15s)
        const handshakeTimeout = setTimeout(() => {
          if (!connectResolved) {
            connectResolved = true;
            reject(new Error('Gateway handshake timeout (15s)'));
            this.ws?.close();
          }
        }, 15000);

        const finalize = (success: boolean, error?: string) => {
          clearTimeout(handshakeTimeout);
          if (connectResolved) return;
          connectResolved = true;
          if (success) {
            this.connected = true;
            this.reconnectAttempts = 0; // Reset counter on successful connection
            this.unsupportedMethods.clear(); // Reset on reconnect — gateway may have been updated
            this.startKeepalive();
            this.emit('connected', this.connectionInfo.agentId);
            resolve();
          } else {
            const errMsg = error || 'Connect rejected by gateway';
            this.emit('error', new Error(errMsg));
            reject(new Error(errMsg));
            this.reconnectAttempts = this.options.maxReconnectAttempts!;
            this.ws?.close();
          }
        };

        this.ws.on('pong', () => {
          this.lastPongAt = Date.now();
        });

        let connectSent = false;

        this.ws.on('open', () => {
          console.log(`[gw-ws] WebSocket open to ${this.connectionInfo.url} for agent ${this.connectionInfo.agentId}`);
          // OpenClaw ws-connection.ts: Gateway ALWAYS sends connect.challenge
          // immediately on WS open (a UUID nonce). The official client uses a
          // 750ms delay to give the challenge time to arrive; if the challenge
          // arrives first it cancels the timer and sends connect with the nonce.
          // The connectSent flag prevents double-send if both timer and challenge fire.
          // v2 auth requires a nonce — wait for connect.challenge instead of blind fallback
          const connectDelay = setTimeout(() => {
            if (connectSent) return;
            connectSent = true;
            console.warn(`[gw-ws] No connect.challenge received within 750ms — sending connect with empty nonce (may fail on v2-only gateways)`);
            connectId = this.sendConnectRequest('');
          }, 750);
          (this as any)._connectDelayTimer = connectDelay;
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message: GatewayWSMessage = JSON.parse(data.toString());

            // During handshake phase: handle responses
            if (!connectResolved) {
              // Gateway ALWAYS sends connect.challenge as the first message.
              // Cancel the fallback timer and send connect with the signed nonce.
              if (message.type === 'event' && message.event === 'connect.challenge') {
                if (connectSent) return; // Already sent connect (timer won the race)
                connectSent = true;
                const nonce = (message.payload as any)?.nonce || '';
                console.log(`[gw-ws] Received connect.challenge nonce=${nonce.substring(0, 12)}… — sending signed connect`);
                if ((this as any)._connectDelayTimer) {
                  clearTimeout((this as any)._connectDelayTimer);
                  (this as any)._connectDelayTimer = null;
                }
                connectId = this.sendConnectRequest(nonce);
                return;
              }

              // Handle hello-ok or rejection
              if (message.type === 'res') {
                console.log(`[gw-ws] Handshake response: ok=${message.ok} id=${message.id} connectId=${connectId} error=${JSON.stringify(message.error)} payload=${JSON.stringify(message.payload)?.substring(0, 300)}`);
                if (connectId && message.id !== connectId) {
                  console.log(`[gw-ws] Ignoring stray response (expected ${connectId}, got ${message.id})`);
                  return; // Stray response, ignore
                }
                if (message.ok) {
                  // Cache the device token from hello-ok if present (for future reconnects)
                  const helloPayload = message.payload as any;
                  if (helloPayload?.auth?.deviceToken) {
                    this.cachedDeviceToken = helloPayload.auth.deviceToken;
                    this.saveDeviceToken();
                    console.log(`[gw-ws] Cached device token for agent ${this.connectionInfo.agentId}`);
                  }
                  // Start tick watchdog using the server-specified interval
                  const tickMs = helloPayload?.policy?.tickIntervalMs;
                  if (typeof tickMs === 'number' && tickMs > 0) {
                    this.serverTickIntervalMs = tickMs;
                  }
                  console.log(`[gw-ws] Connected successfully to agent ${this.connectionInfo.agentId} (tick=${this.serverTickIntervalMs}ms)`);
                  finalize(true);
                } else {
                  const errStr = stringifyError(message.error);
                  const errObj = typeof message.error === 'object' ? message.error as any : {};
                  const isPairing = errStr.includes('pairing') || errObj?.code === 'NOT_PAIRED' || errObj?.code === 'PAIRING_REQUIRED' || errObj?.code === 1008;
                  
                  if (isPairing) {
                    // Device pairing required — reject so connect() loop handles auto-approve.
                    // Do NOT scheduleReconnect here — the connect() 3-attempt loop does that.
                    const pairingRequestId = errObj?.details?.requestId || '';
                    console.warn(`[gw-ws] Pairing required for agent ${this.connectionInfo.agentId} requestId=${pairingRequestId}`);
                    
                    clearTimeout(handshakeTimeout);
                    if (!connectResolved) {
                      connectResolved = true;
                      reject(new Error(`PAIRING_REQUIRED:${pairingRequestId}`));
                    }
                    try { this.ws?.close(); } catch {}
                    this.ws = null;
                    return;
                  } else {
                    console.error(`[gw-ws] Connect rejected: ${errStr} (agent ${this.connectionInfo.agentId})`);
                    finalize(false, errStr);
                  }
                }
                return;
              }

              // Log anything unexpected during handshake
              console.log(`[gw-ws] Handshake message: type=${message.type} event=${message.event || 'n/a'}`);
              return;
            }

            // Normal message handling for established connections
            this.handleMessage(message);
          } catch (err) {
            this.emit('error', new Error(`Failed to parse message: ${err}`));
          }
        });

        this.ws.on('close', (code, reason) => {
          const wasConnected = this.connected;
          this.connected = false;
          this.stopKeepalive();
          const reasonStr = reason?.toString() || '';
          console.log(`[gw-ws] WebSocket closed: code=${code} reason=${reasonStr} wasConnected=${wasConnected} agent=${this.connectionInfo.agentId}`);

          // Prevent duplicate close handling (can happen during reconnect)
          if (this.ws) {
            this.ws.removeAllListeners();
            this.ws = null;
          }

          // Clear stale device token on mismatch (mirrors official GatewayClient behavior).
          // Device token mismatch is recoverable: next connect triggers re-pairing, auto-approve handles it.
          const isDeviceTokenMismatch = code === 1008 && (reasonStr.toLowerCase().includes('device token') || reasonStr.toLowerCase().includes('device_token'));
          if (isDeviceTokenMismatch) {
            console.warn(`[gw-ws] Clearing stale device token for agent ${this.connectionInfo.agentId} — will auto-reconnect`);
            this.cachedDeviceToken = null;
            fs.unlink(this.deviceTokenFile).catch(() => {});
            this.reconnectAttempts = 0; // Reset backoff so we retry promptly
            this.scheduleReconnect();
          }

          if (!connectResolved) {
            clearTimeout(handshakeTimeout);
            connectResolved = true;
            reject(new Error(`Connection closed during handshake: code=${code} reason=${reasonStr}`));
          }

          this.emit('disconnected', {
            agentId: this.connectionInfo.agentId,
            code,
            reason: reasonStr,
          });

          // Reject all pending requests
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
            this.pendingRequests.delete(id);
          }

          // Reconnect strategy based on close code:
          // 1012 = Gateway service restart — reconnect quickly
          // 4000 = Tick timeout (our own watchdog) — reconnect immediately
          // 1008 = Policy violation (auth/pairing/device issues) — may be fatal
          // 1000 = Normal closure — don't reconnect
          const isAuthFailure = reasonStr.includes('invalid') || reasonStr.includes('rejected') || reasonStr.includes('pairing');
          const isServiceRestart = code === 1012;
          const isTickTimeout = code === 4000;

          if (wasConnected && (isServiceRestart || isTickTimeout)) {
            // Fast reconnect for expected disruptions (reset backoff counter)
            this.reconnectAttempts = 0;
            console.log(`[gw-ws] ${isServiceRestart ? 'Service restart' : 'Tick timeout'} — fast reconnect for agent ${this.connectionInfo.agentId}`);
            this.scheduleReconnect();
          } else if (wasConnected && !isAuthFailure && !isDeviceTokenMismatch) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (err) => {
          this.emit('error', err);
          if (!connectResolved) {
            clearTimeout(handshakeTimeout);
            connectResolved = true;
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Send the OpenClaw connect handshake request with device identity.
   * Returns the request ID so we can match the hello-ok response.
   *
   * Uses the exact same client.id / mode / device identity format as the
   * official GatewayClient (src/gateway/client.ts + protocol/client-info.ts):
   *   client.id  = "gateway-client"  (GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT)
   *   client.mode = "backend"        (GATEWAY_CLIENT_MODES.BACKEND)
   *   device: { id, publicKey, signature, signedAt, nonce? }
   */
  private sendConnectRequest(nonce: string): string {
    const id = `req_${++this.requestId}`;
    const signedAt = Date.now();

    const role = 'operator';
    const scopes = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];
    const token = this.connectionInfo.token;

    // Build device identity block (matches official buildDeviceAuthPayload)
    // Always v2 — upstream 2026.2.22 removed v1 support
    const scopeStr = scopes.join(',');
    const parts = ['v2', this.deviceId, 'gateway-client', 'backend', role, scopeStr, String(signedAt), token, nonce];
    const dataToSign = parts.join('|');

    const sigBuf = crypto.sign(
      null,
      Buffer.from(dataToSign, 'utf8'),
      this.devicePrivateKey,
    );
    const signature = sigBuf.toString('base64')
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');

    const device: Record<string, unknown> = {
      id: this.deviceId,
      publicKey: this.devicePublicKeyBase64Url,
      signature,
      signedAt,
      nonce: nonce || '',
    };

    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        displayName: 'havoc-operator',
        version: '1.0.0',
        platform: 'node',
        mode: 'backend',
      },
      device,
      role,
      scopes,
      caps: [],
      commands: [],
      permissions: {},
      auth: {
        token,
        ...(this.cachedDeviceToken ? { deviceToken: this.cachedDeviceToken } : {}),
      },
    };
    console.log(`[gw-ws] Sending connect id=${id} device=${this.deviceId.substring(0, 12)}… nonce=${nonce ? nonce.substring(0, 8) + '…' : 'none'}`);
    this.sendRaw({
      type: 'req',
      id,
      method: 'connect',
      params: connectParams,
    });
    return id;
  }

  /**
   * Auto-approve device pairing using the Docker API (dockerode).
   *
   * Strategy:
   * 1. If we have a requestId from the NOT_PAIRED error, approve it directly
   * 2. If no requestId, list pending devices first, then approve all
   *
   * Uses dockerode's container.exec() instead of shell `docker exec` to
   * avoid PATH/permission issues with the host docker CLI.
   */
  private async autoApproveViaDocker(requestId?: string): Promise<void> {
    const containerName = `openclaw-${this.connectionInfo.agentId}`;
    const now = Date.now();

    // Strategy: Write directly to paired.json inside the container.
    // The CLI-based approach has a chicken-and-egg problem (CLI itself needs pairing).
    // Direct filesystem write bypasses this entirely.
    const entry = {
      deviceId: this.deviceId,
      publicKey: this.devicePublicKeyBase64Url,
      displayName: 'havoc-operator',
      platform: 'node',
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      roles: ['operator'],
      scopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'],
      approvedScopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'],
      tokens: {},
      createdAtMs: now,
      approvedAtMs: now,
    };

    // Read current paired.json, merge our device, write back
    const pairedPath = '/home/node/.openclaw/devices/paired.json';
    const script = `
      const fs = require('fs');
      let paired = {};
      try { paired = JSON.parse(fs.readFileSync('${pairedPath}', 'utf-8')); } catch {}
      paired[${JSON.stringify(this.deviceId)}] = ${JSON.stringify(entry)};
      fs.writeFileSync('${pairedPath}', JSON.stringify(paired, null, 2));
      console.log('OK:' + Object.keys(paired).length);
    `.trim();

    try {
      const output = await dockerService.execInContainer(containerName, ['node', '-e', script], 10000);
      console.log(`[gw-ws] Direct paired.json write for ${containerName}: ${output.trim()}`);

      // Also clear pending.json to remove stale requests
      await dockerService.execInContainer(containerName, [
        'node', '-e', `require('fs').writeFileSync('${pairedPath.replace('paired', 'pending')}', '{}');`
      ], 5000).catch(() => {});
    } catch (err) {
      console.error(`[gw-ws] Failed to write paired.json for ${containerName}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  disconnect(): void {
    this.stopKeepalive();
    // Clear any pending connect delay timer
    if ((this as any)._connectDelayTimer) {
      clearTimeout((this as any)._connectDelayTimer);
      (this as any)._connectDelayTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = Number.MAX_SAFE_INTEGER; // prevent reconnect after intentional disconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    // Clean up login state and listeners
    this.cleanup();
  }

  /** Clean up login state and listeners to prevent memory leaks */
  private cleanup(): void {
    // Clean up all login listeners
    for (const [cacheKey, cleanup] of this.loginCleanups) {
      cleanup.forEach(fn => fn());
    }
    this.loginCleanups.clear();
    this.loginState.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  isReconnecting(): boolean {
    return this.reconnectTimer !== null;
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts!;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.emit('reconnect_failed', this.connectionInfo.agentId);
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with jitter: base * 1.4^attempts, capped at 120s
    const base = this.options.reconnectIntervalMs!;
    const exponential = base * Math.pow(1.4, Math.min(this.reconnectAttempts - 1, 15));
    const capped = Math.min(exponential, 120_000);
    const jitter = capped * 0.2 * Math.random(); // 0-20% jitter
    const delay = Math.round(capped + jitter);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnected', this.connectionInfo.agentId);
      } catch {
        // Will retry via close handler
      }
    }, delay);
  }

  // ── Message Handling ────────────────────────────────────────

  private handleMessage(message: GatewayWSMessage): void {
    switch (message.type) {
      case 'res': {
        const pending = this.pendingRequests.get(message.id!);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id!);
          const payloadPreview = message.payload ? JSON.stringify(message.payload).substring(0, 200) : 'null';
          if (message.ok) {
            console.log(`[gw-ws] ← response ok id=${message.id} payload=${payloadPreview}`);
            pending.resolve(message.payload);
          } else {
            const errStr = stringifyError(message.error);
            // Track unsupported methods to avoid repeated calls + log spam
            if (errStr.includes('unknown method')) {
              this.unsupportedMethods.add(pending.method);
              console.warn(`[gw-ws] Method "${pending.method}" not supported by this gateway version — skipping future calls`);
              pending.resolve(null); // Resolve with null instead of rejecting
            } else {
              console.error(`[gw-ws] ← response error id=${message.id} error=${errStr} payload=${payloadPreview}`);
              pending.reject(new Error(errStr || 'Request failed'));
            }
          }
        }
        break;
      }
      case 'event': {
        // Update tick watchdog timestamp on tick events
        if (message.event === 'tick') {
          this.lastTickAt = Date.now();
        }
        // Gateway sends shutdown event before restart (code 1012). Log it clearly.
        if (message.event === 'shutdown') {
          const restartMs = (message.payload as any)?.restartExpectedMs;
          console.log(`[gw-ws] ← shutdown event for agent ${this.connectionInfo.agentId} (restart expected in ${restartMs ?? '?'}ms)`);
        }
        const eventPayloadPreview = message.payload ? JSON.stringify(message.payload).substring(0, 200) : 'null';
        // Suppress noisy tick events from log
        if (message.event !== 'tick') {
          console.log(`[gw-ws] ← event: ${message.event || 'unknown'} seq=${message.seq || 'n/a'} payload=${eventPayloadPreview}`);
        }
        this.emit('gateway_event', {
          agentId: this.connectionInfo.agentId,
          event: message.event,
          payload: message.payload,
          seq: message.seq,
        });
        // Emit specific event types
        if (message.event) {
          this.emit(`event:${message.event}`, message.payload);
        }
        break;
      }
    }
  }

  // ── Low-level Methods ───────────────────────────────────────

  private sendRaw(data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    this.ws.send(JSON.stringify(data));
  }

  async request(method: string, params: Record<string, unknown> = {}, _retried = false, timeoutOverrideMs?: number): Promise<any> {
    // If not connected, attempt a single reconnect before giving up
    if (!this.connected) {
      if (_retried) {
        throw new Error(`Not connected to gateway (method=${method}, agent=${this.connectionInfo.agentId})`);
      }
      console.log(`[gw-ws] Not connected for ${method} — attempting reconnect before retry (agent=${this.connectionInfo.agentId})`);
      try {
        await this.connect();
      } catch (err) {
        throw new Error(`Reconnect failed for ${method}: ${err instanceof Error ? err.message : err}`);
      }
      return this.request(method, params, true, timeoutOverrideMs);
    }

    // Skip methods the gateway already told us it doesn't support
    if (this.unsupportedMethods.has(method)) {
      return null;
    }

    const id = `req_${++this.requestId}`;
    console.log(`[gw-ws] → request ${method} id=${id} agent=${this.connectionInfo.agentId} params=${JSON.stringify(params)}`);

    const timeoutMs = timeoutOverrideMs ?? this.options.requestTimeoutMs!;
    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(id);
          console.error(`[gw-ws] ✗ timeout ${method} id=${id} after ${timeoutMs}ms`);
          reject(new Error(`Request timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timeout, method });

        this.sendRaw({
          type: 'req',
          id,
          method,
          params,
        });
      });
    } catch (err) {
      // On connection-related errors, retry once with a fresh connection
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError = msg.includes('Connection closed') || msg.includes('ECONNRESET') || msg.includes('not open');
      if (isConnectionError && !_retried) {
        console.log(`[gw-ws] Connection error on ${method} — reconnecting and retrying (agent=${this.connectionInfo.agentId})`);
        try {
          await this.connect();
        } catch {
          throw err; // Reconnect failed, throw original error
        }
        return this.request(method, params, true, timeoutOverrideMs);
      }
      throw err;
    }
  }

  // ── Convenience Methods ─────────────────────────────────────

  // ── Chat ───────────────────────────────────────────────────

  /** Send a message to a specific session (non-blocking, acks with runId) */
  async sendMessage(sessionKey: string, text: string): Promise<{ runId?: string; status?: string }> {
    const result = await this.request('chat.send', {
      sessionKey,
      message: text,
      idempotencyKey: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    });
    return result || {};
  }

  /** Get chat history for a session */
  async getChatHistory(sessionKey: string, limit: number = 50): Promise<GatewayMessage[]> {
    const result = await this.request('chat.history', { sessionKey, limit });
    return result?.messages || [];
  }

  /** Abort a running agent turn for a session */
  async chatAbort(sessionKey: string): Promise<void> {
    await this.request('chat.abort', { sessionKey });
  }

  /** Inject an assistant note into the session transcript (no agent run) */
  async chatInject(sessionKey: string, text: string): Promise<void> {
    await this.request('chat.inject', { sessionKey, text });
  }

  /**
   * Subscribe to session-specific chat events (delta, run.complete, etc.).
   * Reduces event volume when multiple sessions/channels are active.
   * Events arrive via the normal gateway_event emitter.
   * Note: Not all gateway versions support this — unsupported returns null.
   */
  async chatSubscribe(sessionKey: string): Promise<void> {
    await this.request('chat.subscribe', { sessionKey });
  }

  /** Unsubscribe from session chat events */
  async chatUnsubscribe(sessionKey: string): Promise<void> {
    await this.request('chat.unsubscribe', { sessionKey });
  }

  // ── Sessions ───────────────────────────────────────────────

  /** List all active sessions (with derived titles and last-message preview for friendly labels) */
  async listSessions(): Promise<GatewaySession[]> {
    const result = await this.request('sessions.list', {
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
    const sessions = result?.sessions || [];
    // Fetch real message counts per session via chat.history
    const enriched = await Promise.all(sessions.map(async (s: any) => {
      if (s.messageCount > 0) return s;
      try {
        const history = await this.getChatHistory(s.key, 200);
        const visible = (history || []).filter((m: any) => {
          const role = m.role;
          if (role !== 'user' && role !== 'assistant') return false;
          const text = typeof m.content === 'string' ? m.content.trim() : Array.isArray(m.content) ? m.content.map((b: any) => b?.text || '').join('').trim() : '';
          if (!text) return false;
          if (text === 'HEARTBEAT_OK' || text.startsWith('HEARTBEAT_OK')) return false;
          if (text.startsWith('Read HEARTBEAT.md') || text.includes('reply HEARTBEAT_OK')) return false;
          if (text.startsWith('[Cron job') || text.startsWith('[Scheduled task')) return false;
          if (text.startsWith('Read BOOTSTRAP.md')) return false;
          if (text.includes('conversation_label')) return false;
          return true;
        });
        return { ...s, messageCount: visible.length };
      } catch (err) {
        console.warn(`[gw-ws] chat.history failed for ${s.key}:`, err instanceof Error ? err.message : err);
        return { ...s, messageCount: 0 };
      }
    }));
    return enriched;
  }

  /** Get session history (alias for chat.history for backward compat) */
  async getSessionHistory(sessionKey: string, limit: number = 50): Promise<GatewayMessage[]> {
    return this.getChatHistory(sessionKey, limit);
  }

  /** Get session status */
  async getSessionStatus(sessionKey: string): Promise<any> {
    return this.request('session.status', { sessionKey });
  }

  /** Patch session settings (thinking/verbose overrides, sendPolicy, etc.) */
  async patchSession(sessionKey: string, patch: Record<string, unknown>): Promise<void> {
    await this.request('sessions.patch', { sessionKey, ...patch });
  }

  /** Send an outbound message to a channel target (human handoff reply) */
  async outboundMessage(channel: string, target: string, text: string): Promise<void> {
    await this.request('message.send', { channel, target, text });
  }

  // ── Config ─────────────────────────────────────────────────

  /** Get the full OpenClaw config + hash */
  async configGet(): Promise<{ config: any; hash: string }> {
    const result = await this.request('config.get', {});
    return { config: result?.payload || result?.config || result, hash: result?.hash || '' };
  }

  /** Set a single config key */
  async configSet(key: string, value: unknown): Promise<void> {
    await this.request('config.set', { key, value });
  }

  /** Partial config update (merge-patch semantics) */
  async configPatch(raw: string, baseHash: string, opts?: { sessionKey?: string; restartDelayMs?: number }): Promise<void> {
    await this.request('config.patch', {
      raw,
      baseHash,
      ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
      ...(opts?.restartDelayMs ? { restartDelayMs: opts.restartDelayMs } : {}),
    });
  }

  /** Replace the entire config + restart */
  async configApply(raw: string, baseHash?: string, opts?: { sessionKey?: string; restartDelayMs?: number }): Promise<void> {
    await this.request('config.apply', {
      raw,
      ...(baseHash ? { baseHash } : {}),
      ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
      ...(opts?.restartDelayMs ? { restartDelayMs: opts.restartDelayMs } : {}),
    });
  }

  /** Get config JSON schema for form rendering */
  async configSchema(): Promise<any> {
    return this.request('config.schema', {});
  }

  // ── Skills ─────────────────────────────────────────────────

  /** Get skills status (eligible, installed, etc.) from the running gateway */
  async skillsList(): Promise<any> {
    return this.request('skills.list', {});
  }

  /** Enable or disable a skill (OpenClaw uses skills.update with enabled, not skills.toggle) */
  async skillsToggle(slug: string, enabled: boolean): Promise<void> {
    await this.request('skills.update', { skillKey: slug, enabled });
  }

  /** Install a skill via ClawHub slug (OpenClaw expects name + installId) */
  async skillsInstall(slug: string): Promise<void> {
    await this.request('skills.install', {
      name: slug,
      installId: `clawhub:${slug}`,
    });
  }

  /** Update a skill's API key or env vars (OpenClaw expects skillKey, not slug) */
  async skillsUpdate(slug: string, updates: { apiKey?: string; env?: Record<string, string> }): Promise<void> {
    await this.request('skills.update', { skillKey: slug, ...updates });
  }

  // ── Channels ───────────────────────────────────────────────

  /** Get channel connection status from the running gateway */
  async channelsStatus(): Promise<any> {
    return this.request('channels.status', {});
  }

  // ── Models ─────────────────────────────────────────────────

  /** List available models from the running gateway */
  async modelsList(): Promise<any> {
    return this.request('models.list', {});
  }

  // ── System ─────────────────────────────────────────────────

  /** Get gateway status snapshot */
  async getStatus(): Promise<any> {
    return this.request('status', {});
  }

  /** Get gateway health status (normalizes ok→status for frontend) */
  async getHealth(): Promise<{
    status: string;
    ok?: boolean;
    channels: Record<string, any>;
    uptime?: number;
  }> {
    const raw: any = await this.request('health', {});
    // OpenClaw returns { ok: true, channels: {...} } — normalize to { status: "ok" }
    if (raw && !raw.status && typeof raw.ok === 'boolean') {
      raw.status = raw.ok ? 'ok' : 'degraded';
    }
    return raw;
  }

  /** Get connected clients/nodes presence */
  async getPresence(): Promise<any> {
    return this.request('system-presence', {});
  }

  /** List connected nodes + their capabilities */
  async nodeList(): Promise<any> {
    return this.request('node.list', {});
  }

  /** Tail gateway file logs */
  async logsTail(params?: { lines?: number; filter?: string }): Promise<any> {
    return this.request('logs.tail', params || {});
  }

  // ── Memory ─────────────────────────────────────────────────

  /**
   * Search agent memory using OpenClaw's built-in embedding search.
   * Docs: https://docs.openclaw.ai/memory#search-api
   */
  async memorySearch(query: string, opts?: { limit?: number; threshold?: number }): Promise<MemorySearchResult[]> {
    const result = await this.request('memory.search', {
      query,
      limit: opts?.limit ?? 10,
      ...(opts?.threshold !== undefined ? { threshold: opts.threshold } : {}),
    });
    // Gateway returns { results: [...] } or an array directly
    const hits = result?.results || result?.hits || (Array.isArray(result) ? result : []);
    return hits as MemorySearchResult[];
  }

  // ── Cron ───────────────────────────────────────────────────

  /** Add a cron job */
  async addCronJob(job: CronJobConfig): Promise<string> {
    const payload: Record<string, unknown> = {
      name: job.name,
      sessionTarget: job.sessionTarget || 'isolated',
      payload: job.payload || { kind: 'agentTurn', message: '' },
    };
    if (job.schedule) payload.schedule = job.schedule;
    if (job.description) payload.description = job.description;
    if (job.enabled === false) payload.enabled = false;
    if (job.deleteAfterRun != null) payload.deleteAfterRun = job.deleteAfterRun;
    if (job.delivery) payload.delivery = job.delivery;
    const result = await this.request('cron.add', payload);
    return result?.jobId || '';
  }

  /** List cron jobs */
  async listCronJobs(): Promise<any[]> {
    const result = await this.request('cron.list', {});
    return result?.jobs || [];
  }

  /** Remove a cron job */
  async removeCronJob(jobId: string): Promise<void> {
    await this.request('cron.rm', { id: jobId });
  }

  /** Run a cron job immediately */
  async runCronJob(jobId: string, force?: boolean): Promise<void> {
    await this.request('cron.run', { id: jobId, ...(force ? { force: true } : {}) });
  }

  /** Enable a cron job */
  async enableCronJob(jobId: string): Promise<void> {
    await this.request('cron.enable', { id: jobId });
  }

  /** Disable a cron job */
  async disableCronJob(jobId: string): Promise<void> {
    await this.request('cron.disable', { id: jobId });
  }

  /** Get cron job run history */
  async cronRuns(jobId: string, limit?: number): Promise<any[]> {
    const result = await this.request('cron.runs', { id: jobId, ...(limit ? { limit } : {}) });
    return result?.runs || [];
  }

  // ── Exec Approvals ─────────────────────────────────────────

  /** Resolve an exec approval request (OpenClaw: id + decision) */
  async execApprovalResolve(requestId: string, approved: boolean): Promise<void> {
    await this.request('exec.approval.resolve', {
      id: requestId,
      decision: approved ? 'allow-once' : 'deny',
    });
  }

  /** List pending exec approval requests. OpenClaw protocol has exec.approval.resolve only, no list method. */
  async execApprovalsList(): Promise<any[]> {
    // Protocol: exec.approval.requested is broadcast; resolve via exec.approval.resolve. No list RPC.
    return [];
  }

  // ── DM Pairing ────────────────────────────────────────────

  /** List pending DM pairing requests for a channel */
  async pairingList(channel: string): Promise<any[]> {
    const result = await this.request('pairing.list', { channel });
    return result?.requests ?? (Array.isArray(result) ? result : []);
  }

  /** Approve a DM pairing request */
  async pairingApprove(channel: string, code: string): Promise<void> {
    await this.request('pairing.approve', { channel, code });
  }

  /** Reject a DM pairing request */
  async pairingReject(channel: string, code: string): Promise<void> {
    await this.request('pairing.reject', { channel, code });
  }

  // ── Session Management (Advanced) ─────────────────────────

  /** Reset a session (clear history, keep workspace) */
  async sessionReset(sessionKey: string): Promise<void> {
    await this.request('sessions.reset', { sessionKey });
  }

  /** Delete a session entirely */
  async sessionDelete(sessionKey: string): Promise<void> {
    await this.request('sessions.delete', { sessionKey });
  }

  /** Compact a session (summarize and trim context) */
  async sessionCompact(sessionKey: string): Promise<void> {
    await this.request('sessions.compact', { sessionKey });
  }

  // ── Agent Files ──────────────────────────────────────────

  /** List workspace files */
  async agentFilesList(path?: string): Promise<any[]> {
    const result = await this.request('agents.files.list', { path: path || '/' });
    return result?.files || [];
  }

  /** Read a workspace file */
  async agentFileRead(path: string): Promise<string> {
    const result = await this.request('agents.files.read', { path });
    return result?.content || '';
  }

  /** Write a workspace file */
  async agentFileWrite(path: string, content: string): Promise<void> {
    await this.request('agents.files.write', { path, content });
  }

  // ── TTS ──────────────────────────────────────────────────

  /** Get TTS status */
  async ttsStatus(): Promise<any> {
    return this.request('tts.status', {});
  }

  /** Enable/disable TTS */
  async ttsSetEnabled(enabled: boolean): Promise<void> {
    await this.request(enabled ? 'tts.enable' : 'tts.disable', {});
  }

  /** List available TTS providers and voices */
  async ttsProviders(): Promise<any> {
    return this.request('tts.providers', {});
  }

  // ── Usage ────────────────────────────────────────────────

  /** Get current token usage stats */
  async usageStatus(): Promise<any> {
    return this.request('usage.status', {});
  }

  /** Get cost breakdown */
  async usageCost(): Promise<any> {
    return this.request('usage.cost', {});
  }

  /** Get sessions usage with message counts */
  async sessionsUsage(): Promise<any> {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return this.request('sessions.usage', {
      startDate: start.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
      limit: 9999,
    });
  }

  // ── Channel Logout ───────────────────────────────────────

  /** Logout from a channel (disconnect) */
  async channelLogout(channel: string): Promise<void> {
    await this.request('channels.logout', { channel });
  }

  // ── Channel Login (QR Code) ───────────────────────────────

  /** Cached QR login state from gateway events */
  private loginState = new Map<string, { qr?: string; code?: string; status?: string; linked?: boolean; error?: string; updatedAt: number }>();
  /** Active login cleanup functions — keyed by cacheKey to prevent listener accumulation */
  private loginCleanups = new Map<string, (() => void)[]>();

  /** Start channel login flow (e.g. WhatsApp QR). Set force=true to relink when already connected. */
  async channelLoginStart(channel: string = 'whatsapp', account: string = 'default', force = false): Promise<any> {
    // Listen for QR events from the gateway (events may arrive before or after the response)
    const qrEventNames = ['web.login.qr', 'web.login.code', 'web.login.success', 'web.login.fail', 'web.login.update'];
    const cacheKey = `${channel}:${account}`;

    // Clean up previous listeners for this channel (prevents accumulation on repeated calls)
    const prevCleanup = this.loginCleanups.get(cacheKey);
    if (prevCleanup) prevCleanup.forEach(fn => fn());

    const cleanup: (() => void)[] = [];
    
    for (const eventName of qrEventNames) {
      const handler = (payload: any) => {
        console.log(`[gw-ws] 📱 Login event: ${eventName}`, JSON.stringify(payload).substring(0, 300));
        const existing = this.loginState.get(cacheKey) || { updatedAt: Date.now() };
        if (payload?.qr || payload?.qrCode) existing.qr = payload.qr || payload.qrCode;
        if (payload?.qrDataUrl) existing.qr = payload.qrDataUrl; // base64 PNG data URI
        if (payload?.code) existing.code = payload.code;
        if (payload?.status) existing.status = payload.status;
        if (payload?.linked !== undefined) existing.linked = payload.linked;
        if (payload?.error) existing.error = payload.error;
        if (eventName === 'web.login.success') { existing.status = 'connected'; existing.linked = true; }
        if (eventName === 'web.login.fail') { existing.status = 'error'; existing.error = payload?.error || payload?.reason || 'Login failed'; }
        existing.updatedAt = Date.now();
        this.loginState.set(cacheKey, existing);
      };
      this.on(`event:${eventName}`, handler);
      cleanup.push(() => this.off(`event:${eventName}`, handler));
    }

    // Auto-cleanup listeners after 5 minutes
    this.loginCleanups.set(cacheKey, cleanup);
    setTimeout(() => { 
      cleanup.forEach(fn => fn()); 
      this.loginCleanups.delete(cacheKey); 
      this.loginState.delete(cacheKey);
    }, 5 * 60 * 1000);

    // Clear any stale login state
    this.loginState.delete(cacheKey);

    try {
      // web.login.start — WhatsApp is the implicit web channel.
      // force=true: relink (disconnect and show fresh QR when already linked)
      // timeoutMs: OpenClaw's startWebLoginWithQr defaults to 30s — pass 60s so Baileys has time to connect & emit QR
      const baseParams = account && account !== 'default' ? { accountId: account, force } : force ? { force: true } : {};
      const params = { ...baseParams, timeoutMs: 60_000 };
      // Backend request timeout: 65s so we don't abort before OpenClaw returns
      const requestPromise = this.request('web.login.start', params, false, 65_000);
      const result = force
        ? await Promise.race([
            requestPromise,
            new Promise<any>((r) => setTimeout(() => r({
              status: 'started',
              message: 'QR generation in progress. If it does not appear within 30 seconds, close and try Relink again.',
            }), 10_000)),
          ])
        : await requestPromise;
      console.log(`[gw-ws] web.login.start response:`, JSON.stringify(result).substring(0, 500));

      // Mark login as in progress immediately so hasActiveChannelLogin blocks config.patch
      // (QR may arrive via event later — we need to block restart from the start)
      const existing = this.loginState.get(cacheKey) || { updatedAt: Date.now() };
      existing.status = result?.status || 'started';
      if (result?.qr || result?.qrCode || result?.qrDataUrl || result?.code) {
        existing.qr = result.qrDataUrl || result.qr || result.qrCode;
        existing.code = result.code;
      }
      existing.updatedAt = Date.now();
      this.loginState.set(cacheKey, existing);
      
      // Fire-and-forget: web.login.wait blocks until connected or timeout — updates cache when done.
      // Fallback for gateways that don't support it (resolve to events only).
      const accountParam = account && account !== 'default' ? { accountId: account } : {};
      this.request('web.login.wait', { ...accountParam, timeoutMs: 180_000 })
        .then((waitResult: any) => {
          if (waitResult?.connected) {
            const existing = this.loginState.get(cacheKey) || { updatedAt: Date.now() };
            existing.status = 'connected';
            existing.linked = true;
            existing.updatedAt = Date.now();
            this.loginState.set(cacheKey, existing);
            console.log(`[gw-ws] web.login.wait: connected`);
          } else if (waitResult?.error || waitResult?.message) {
            // Gateway returned error (e.g. 515 Unknown Stream Errored)
            const errMsg = waitResult.error || waitResult.message;
            const existing = this.loginState.get(cacheKey) || { updatedAt: Date.now() };
            existing.status = 'error';
            existing.error = errMsg;
            existing.updatedAt = Date.now();
            this.loginState.set(cacheKey, existing);
            console.warn(`[gw-ws] web.login.wait error (from gateway):`, errMsg);
          }
        })
        .catch((e) => {
          if (!String(e?.message || e).includes('unknown method')) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn(`[gw-ws] web.login.wait failed:`, errMsg);
            const existing = this.loginState.get(cacheKey) || { updatedAt: Date.now() };
            existing.status = 'error';
            existing.error = errMsg;
            existing.updatedAt = Date.now();
            this.loginState.set(cacheKey, existing);
          }
        });

      // Return cached state merged with response
      const cached = this.loginState.get(cacheKey);
      return { ...result, ...cached, status: cached?.status || result?.status || 'started' };
    } catch (err) {
      cleanup.forEach(fn => fn());
      throw err;
    }
  }

  /** Get channel login status (QR code data, connection status).
   *  Note: OpenClaw has no `web.login.status` RPC — status comes from
   *  WebSocket events (web.login.qr, web.login.success, etc.) that are
   *  cached locally by channelLoginStart(). This method returns that cache. */
  async channelLoginStatus(channel: string = 'whatsapp', account: string = 'default'): Promise<any> {
    const cacheKey = `${channel}:${account}`;
    const cached = this.loginState.get(cacheKey);
    if (cached) {
      return { ...cached };
    }
    // No cached state — login probably hasn't been started yet
    return { status: 'idle', message: 'No active login session. Call login/start first.' };
  }

  /** Stop/cancel channel login flow */
  async channelLoginStop(channel: string = 'whatsapp', account: string = 'default'): Promise<void> {
    const cacheKey = `${channel}:${account}`;
    this.loginState.delete(cacheKey);
    // Clean up any active listeners for this channel
    const cleanup = this.loginCleanups.get(cacheKey);
    if (cleanup) {
      cleanup.forEach(fn => fn());
      this.loginCleanups.delete(cacheKey);
    }
    // OpenClaw has no web.login.stop — QR expires on its own, no need to call non-existent RPC
  }

  /**
   * Returns true if a channel login (QR flow) is in progress.
   * Used to avoid config.patch during login — OpenClaw restarts on patch and wipes active login state.
   */
  hasActiveChannelLogin(): boolean {
    const now = Date.now();
    const maxAgeMs = 5 * 60 * 1000; // 5 minutes
    const staleMs = 10 * 60 * 1000; // 10 minutes — evict finished/stale entries
    let hasActive = false;
    for (const [key, entry] of this.loginState) {
      const age = now - (entry?.updatedAt ?? 0);
      if (age > staleMs) { this.loginState.delete(key); continue; }
      const status = entry?.status || '';
      const isActive = ['started', 'waiting'].includes(status);
      if (isActive && age < maxAgeMs) hasActive = true;
    }
    return hasActive;
  }
}

// ── Gateway Connection Manager ──────────────────────────────────
// Manages connections to multiple running OpenClaw gateways

export class GatewayManager extends EventEmitter {
  private clients = new Map<string, GatewayWSClient>();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 60_000; // 60s

  /**
   * Start periodic health monitoring for all connected agents.
   * Detects silently dead connections and force-reconnects them.
   */
  startHealthLoop(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(async () => {
      for (const [agentId, client] of this.clients) {
        if (!client.isConnected()) {
          // Skip if already reconnecting (scheduleReconnect timer active)
          if (client.isReconnecting()) continue;
          // Check if agent still exists in DB before reconnecting
          try {
            const db = getDatabase();
            const agent = await db.collection('agents').findOne(
              { _id: new ObjectId(agentId), status: 'running' },
              { projection: { _id: 1 } }
            );
            if (!agent) {
              console.warn(`[gw-manager] Agent ${agentId} no longer exists — removing from manager`);
              client.disconnect();
              this.clients.delete(agentId);
              continue;
            }
          } catch { /* DB unavailable — try reconnect anyway */ }

          console.warn(`[gw-manager] Agent ${agentId} disconnected — triggering reconnect`);
          this.emit('agent_health_degraded', agentId);
          client.connect().catch(() => {});
        }
      }
    }, GatewayManager.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop the health monitoring loop.
   */
  stopHealthLoop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Connect to an agent's gateway
   */
  async connectAgent(info: GatewayConnectionInfo): Promise<GatewayWSClient> {
    // Disconnect existing connection if any
    const existing = this.clients.get(info.agentId);
    if (existing) {
      existing.disconnect();
    }

    const client = new GatewayWSClient(info);

    // Forward events
    client.on('gateway_event', (data) => this.emit('gateway_event', data));
    client.on('connected', (agentId) => this.emit('agent_connected', agentId));
    client.on('disconnected', (data) => this.emit('agent_disconnected', data));
    client.on('error', (err) => this.emit('error', err));
    client.on('reconnect_failed', (agentId) => this.emit('reconnect_failed', agentId));

    await client.connect();
    this.clients.set(info.agentId, client);

    // Auto-start health loop when first agent connects
    if (this.clients.size === 1) {
      this.startHealthLoop();
    }

    return client;
  }

  /**
   * Disconnect from an agent's gateway
   */
  disconnectAgent(agentId: string): void {
    const client = this.clients.get(agentId);
    if (client) {
      client.disconnect();
      this.clients.delete(agentId);
    }
    // Stop health loop when no agents remain
    if (this.clients.size === 0) {
      this.stopHealthLoop();
    }
  }

  /**
   * Get client for an agent
   */
  getClient(agentId: string): GatewayWSClient | undefined {
    return this.clients.get(agentId);
  }

  /**
   * Check if connected to an agent
   */
  isConnected(agentId: string): boolean {
    return this.clients.get(agentId)?.isConnected() || false;
  }

  /**
   * True if agent has an active channel login (QR flow) in progress.
   * Used to skip config.patch — OpenClaw restarts on patch and wipes login state.
   */
  hasActiveChannelLogin(agentId: string): boolean {
    return this.clients.get(agentId)?.hasActiveChannelLogin() || false;
  }

  /**
   * Get all connected agent IDs
   */
  getConnectedAgents(): string[] {
    return Array.from(this.clients.entries())
      .filter(([_, client]) => client.isConnected())
      .map(([agentId]) => agentId);
  }

  /**
   * Disconnect all gateways
   */
  disconnectAll(): void {
    this.stopHealthLoop();
    for (const [, client] of this.clients) {
      client.disconnect();
    }
    this.clients.clear();
  }
}

// Singleton instance
export const gatewayManager = new GatewayManager();

// Prevent unhandled 'error' events from crashing the process.
// Gateway connection failures are expected (e.g. container not ready yet)
// and are handled per-request in route handlers via try/catch.
gatewayManager.on('error', (err) => {
  console.warn('[gw-ws] Gateway manager error (handled):', err instanceof Error ? err.message : err);
});
