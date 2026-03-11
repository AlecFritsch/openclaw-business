// Docker Service - Safe container orchestration using Docker SDK

import { execSync } from 'child_process';
import path from 'path';
import Docker from 'dockerode';
import WebSocket from 'ws';
import crypto from 'crypto';
import { config } from '../config/env.js';

const docker = new Docker();

export interface CreateContainerOptions {
  name: string;
  image: string;
  workspacePath: string;
  gatewayPort: number;
  agentId: string;
  env?: Record<string, string>;
}

export class DockerService {
  private dockerNetwork = 'openclaw-network';
  private networkReady: Promise<void> | null = null;

  private async ensureNetwork(): Promise<void> {
    if (!this.networkReady) {
      this.networkReady = (async () => {
        try {
          await docker.getNetwork(this.dockerNetwork).inspect();
        } catch {
          await docker.createNetwork({
            Name: this.dockerNetwork,
            Driver: 'bridge',
          });
          console.log(`Created Docker network: ${this.dockerNetwork}`);
        }
      })().catch((err) => {
        // Reset cache on failure so next call retries
        this.networkReady = null;
        throw err;
      });
    }
    return this.networkReady;
  }

  /**
   * Ensure the OpenClaw image exists. If not, builds it from openclaw-secure/Dockerfile.
   * Uses docker CLI (simpler than Dockerode build stream). First deploy after image
   * deletion may take a few minutes.
   */
  async ensureImageExists(imageTag: string): Promise<void> {
    try {
      await docker.getImage(imageTag).inspect();
      return; // Image exists
    } catch {
      // Image doesn't exist — build it
    }

    const projectRoot = path.resolve(config.openclawProjectRoot);
    const dockerfilePath = path.join(projectRoot, 'openclaw-secure', 'Dockerfile');
    const { existsSync } = await import('node:fs');
    if (!existsSync(dockerfilePath)) {
      throw new Error(
        `openclaw-secure/Dockerfile not found at ${dockerfilePath}. Set OPENCLAW_PROJECT_ROOT or run from agenix root.`
      );
    }

    console.log(`[docker] Building openclaw-secure image (first deploy or image was deleted)...`);
    execSync(
      `docker build -f openclaw-secure/Dockerfile -t ${imageTag} .`,
      {
        cwd: projectRoot,
        stdio: 'inherit',
      }
    );
    console.log(`[docker] Image ${imageTag} built successfully`);
  }

  async createContainer(options: CreateContainerOptions): Promise<string> {
    await this.ensureNetwork();
    await this.ensureImageExists(options.image);
    const { name, image, workspacePath, gatewayPort, agentId, env = {} } = options;

    // ── Container config matches official Hetzner Docker guide exactly ──
    // https://docs.openclaw.ai/install/hetzner
    // No CapDrop, no Tmpfs, no Init, no SecurityOpt — these kill the gateway.
    // Run as backend user so workspace files (openclaw.json, creds) are readable by backend.
    const runAsUser =
      typeof process.getuid === 'function' && typeof process.getgid === 'function'
        ? `${process.getuid()}:${process.getgid()}`
        : undefined;

    const container = await docker.createContainer({
      name,
      Image: image,
      User: runAsUser,
      Env: [
        `HOME=/home/node`,
        `NODE_ENV=production`,
        `TERM=xterm-256color`,
        `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
        `XDG_CONFIG_HOME=/home/node/.openclaw`,
        `OPENCLAW_GATEWAY_TOKEN=${env.OPENCLAW_GATEWAY_TOKEN || ''}`,
        `OPENCLAW_GATEWAY_PORT=18789`,
        `OPENCLAW_GATEWAY_BIND=lan`,
        `OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789`,
        `GOG_KEYRING_PASSWORD=${env.GOG_KEYRING_PASSWORD || crypto.randomUUID()}`,
        `SHELL_AUTO_APPROVE=false`,
        ...Object.entries(env)
          .filter(([k]) => !['OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_PORT', 'OPENCLAW_GATEWAY_BIND', 'OPENCLAW_GATEWAY_URL', 'GOG_KEYRING_PASSWORD'].includes(k))
          .map(([k, v]) => `${k}=${v}`),
      ],
      ExposedPorts: {
        '18789/tcp': {},
      },
      HostConfig: {
        PortBindings: {
          '18789/tcp': [{ HostIp: '127.0.0.1', HostPort: `${gatewayPort}` }],
        },
        Binds: [
          `${workspacePath}:/home/node/.openclaw:rw`,
        ],
        // host.docker.internal → host (Linux Docker lacks this by default; superchat_send needs backend URL)
        ExtraHosts: ['host.docker.internal:host-gateway'],
        NetworkMode: this.dockerNetwork,
        RestartPolicy: {
          Name: 'unless-stopped',
        },
        LogConfig: {
          Type: 'json-file',
          Config: { 'max-size': '50m', 'max-file': '3' },
        },
      },
      Labels: {
        'agenix.agent-id': agentId,
        'agenix.managed': 'true',
      },
      Healthcheck: {
        Test: ['CMD-SHELL', `node -e "const r=require('http').request({hostname:'127.0.0.1',port:18789,headers:{Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'aGVhbHRo'}});r.on('upgrade',()=>process.exit(0));r.on('error',()=>process.exit(1));r.setTimeout(10000,()=>process.exit(1));r.end()"`],
        Interval: 30000000000,
        Timeout: 15000000000,
        StartPeriod: 120000000000,
        Retries: 3,
      },
    });

    await container.start();
    return container.id;
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    try {
      await container.stop({ t: 10 });
    } catch (err: any) {
      // Ignore "container already stopped" errors (304 Not Modified)
      if (err?.statusCode === 304 || err?.message?.includes('already stopped')) {
        return;
      }
      throw err;
    }
  }

  async startContainer(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    await container.start();
  }

  async deleteContainer(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    
    try {
      await container.stop({ t: 10 });
    } catch {
      // Already stopped or doesn't exist
    }
    
    try {
      await container.remove({ force: true });
    } catch {
      // Container already removed or never existed
    }
  }

  async getContainerStatus(containerId: string): Promise<'running' | 'stopped' | 'error'> {
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      
      if (info.State.Running) return 'running';
      if (info.State.Status === 'exited' || info.State.Status === 'created') return 'stopped';
      return 'error';
    } catch {
      return 'error';
    }
  }

  /** Find container by agent ID (name: openclaw-{agentId}). Returns id and host port if running. */
  async findContainerByAgentId(agentId: string): Promise<{ id: string; port: number } | null> {
    const name = `openclaw-${agentId}`;
    const containers = await docker.listContainers({
      all: false,
      filters: { name: [name] },
    });
    if (containers.length === 0) return null;
    const c = containers[0];
    const port = (c.Ports || []).find((p: any) => p.PrivatePort === 18789)?.PublicPort;
    if (!port) return null;
    return { id: c.Id, port };
  }

  async getContainerLogs(containerId: string, lines: number = 100): Promise<string> {
    try {
      const container = docker.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: lines,
        follow: false,
      });

      // dockerode can return a Buffer OR a readable stream depending on
      // whether the container uses a TTY. Normalise to Buffer first.
      let buf: Buffer;
      if (Buffer.isBuffer(logs)) {
        buf = logs;
      } else if (typeof logs === 'string') {
        buf = Buffer.from(logs, 'utf-8');
      } else if (typeof (logs as any).read === 'function' || typeof (logs as any).on === 'function') {
        // It's a stream — collect all chunks
        buf = await new Promise<Buffer>((resolve, reject) => {
          const stream = logs as NodeJS.ReadableStream;
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
          // Safety timeout — don't hang forever
          setTimeout(() => resolve(Buffer.concat(chunks)), 5000);
        });
      } else {
        buf = Buffer.from(String(logs), 'utf-8');
      }

      if (buf.length === 0) return '';

      // Docker multiplexed streams have 8-byte headers per frame:
      //   [stream_type(1)] [0(3)] [size(4)] [payload...]
      // Strip these headers to get clean text output
      const chunks: string[] = [];
      let offset = 0;

      while (offset < buf.length) {
        if (offset + 8 > buf.length) {
          // Remaining bytes don't form a complete header — treat as raw text
          chunks.push(buf.subarray(offset).toString('utf-8'));
          break;
        }

        const streamType = buf.readUInt8(offset);
        // Valid stream types: 0 (stdin), 1 (stdout), 2 (stderr)
        if (streamType > 2) {
          // Not a multiplexed stream — return entire buffer as plain text
          return buf.toString('utf-8');
        }

        const frameSize = buf.readUInt32BE(offset + 4);
        offset += 8;

        if (offset + frameSize > buf.length) {
          chunks.push(buf.subarray(offset).toString('utf-8'));
          break;
        }

        chunks.push(buf.subarray(offset, offset + frameSize).toString('utf-8'));
        offset += frameSize;
      }

      return chunks.join('');
    } catch (err) {
      console.error(`[docker] getContainerLogs failed for ${containerId.substring(0, 12)}:`, err);
      return '';
    }
  }

  /**
   * Wait for container to become healthy by probing the Gateway WebSocket.
   *
   * OpenClaw's Gateway is a WebSocket server — there is NO HTTP /health
   * endpoint. We probe readiness by attempting a WebSocket connection to
   * ws://127.0.0.1:{hostPort}. If the connection opens, the gateway is up.
   *
   * We also check Docker container state to fail fast if it dies, and
   * parse container logs for the "[gateway] listening on" line as a
   * fast-path signal.
   *
   * @param containerId  Docker container ID
   * @param hostPort     The host port mapped to container port 18789
   * @param gatewayToken  The gateway auth token (required for WS probe)
   * @param maxWaitSeconds  Maximum time to wait (default 300s — OpenClaw may compile native addons on cold start)
   */
  async waitForHealthy(containerId: string, hostPort: number, gatewayToken?: string, maxWaitSeconds: number = 300): Promise<void> {
    const container = docker.getContainer(containerId);
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;
    let attempt = 0;

    console.log(`[health] Waiting for container ${containerId.substring(0, 12)} on port ${hostPort} (max ${maxWaitSeconds}s)...`);

    while (Date.now() - startTime < maxWaitMs) {
      attempt++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 1. Check container is still alive
      let state;
      try {
        state = await container.inspect();
      } catch (err) {
        console.error(`[health] attempt=${attempt} (${elapsed}s) — inspect failed:`, err);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (!state.State.Running) {
        const logs = await this.getContainerLogs(containerId, 50);
        throw new Error(`Container stopped unexpectedly (status=${state.State.Status}, exitCode=${state.State.ExitCode}). Logs:\n${logs}`);
      }

      // 2. If Docker already says healthy (after Dockerfile HEALTHCHECK passes), done
      const healthStatus = state.State.Health?.Status;
      if (healthStatus === 'healthy') {
        console.log(`[health] Container healthy via Docker HEALTHCHECK (${elapsed}s)`);
        return;
      }

      // 3. Fast-path: check Docker stdout logs + internal log file for "listening on"
      let combinedLogs = '';
      try {
        const dockerLogs = await this.getContainerLogs(containerId, 30);
        combinedLogs = dockerLogs;

        // Fallback: read OpenClaw's internal log file (it writes to /tmp/openclaw/*.log)
        if (!dockerLogs.trim()) {
          try {
            const exec = await container.exec({
              Cmd: ['sh', '-c', 'cat /tmp/openclaw/*.log 2>/dev/null | tail -20'],
              AttachStdout: true,
              AttachStderr: true,
            });
            const stream = await exec.start({ Detach: false, Tty: false });
            const fileLog = await new Promise<string>((resolve) => {
              const chunks: Buffer[] = [];
              stream.on('data', (chunk: Buffer) => chunks.push(chunk));
              stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
              setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), 3000);
            });
            if (fileLog.trim()) combinedLogs = fileLog;
          } catch {
            // exec failed — container may not support it
          }
        }

        if (combinedLogs.includes('listening on ws://') || combinedLogs.includes('listening on 0.0.0.0:')) {
          console.log(`[health] Gateway ready (detected "listening on" in logs, ${elapsed}s)`);
          return;
        }
        // Log progress every 5 attempts
        if (attempt % 5 === 0) {
          const lastLine = combinedLogs.trim().split('\n').pop()?.substring(0, 120) || '(empty)';
          console.log(`[health] attempt=${attempt} (${elapsed}s) docker-health=${healthStatus || 'n/a'} lastLog: ${lastLine}`);
        }
      } catch (err) {
        console.warn(`[health] attempt=${attempt} (${elapsed}s) — log fetch failed:`, err);
      }

      // 4. WebSocket probe — attempt to connect to the gateway
      //    OpenClaw WS protocol: first frame must be a `connect` message.
      //    Docs: "If OPENCLAW_GATEWAY_TOKEN is set, connect.params.auth.token must match"
      //    If the gateway sends back a hello-ok, it's healthy.
      try {
        const wsUrl = `ws://127.0.0.1:${hostPort}`;
        const wsReady = await new Promise<boolean>((resolve) => {
          let settled = false;
          const done = (result: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            resolve(result);
          };

          const ws = new WebSocket(wsUrl, {
            handshakeTimeout: 3000,
          });
          ws.on('open', () => {
            // Per OpenClaw docs: "First frame must be a connect request."
            // Send connect immediately on open. No device field (requires crypto keys).
            ws.send(JSON.stringify({
              type: 'req',
              id: 'health-probe',
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: { id: 'cli', version: '1.0.0', platform: 'linux' },
                role: 'operator',
                scopes: ['operator.read'],
                ...(gatewayToken ? { auth: { token: gatewayToken } } : {}),
                locale: 'en-US',
                userAgent: 'openclaw-business-health/0.1.0',
              },
            }));
          });
          ws.on('message', (data: Buffer | string) => {
            try {
              const msg = JSON.parse(data.toString());
              // hello-ok response means the gateway is healthy
              if (msg.type === 'res' && msg.ok) {
                done(true);
              }
            } catch {
              // Not JSON — still counts as the server responding
              done(true);
            }
          });
          ws.on('error', () => done(false));
          ws.on('close', () => done(false));
          const timer = setTimeout(() => done(false), 5000);
        });
        if (wsReady) {
          console.log(`[health] Gateway ready via WebSocket probe (${elapsed}s, attempt=${attempt})`);
          return;
        }
      } catch {
        // WS probe threw — keep trying
      }

      // Adaptive polling: faster at start (1s), slower later (3s)
      const pollMs = attempt <= 10 ? 1000 : attempt <= 30 ? 2000 : 3000;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    // Timeout — include logs for debugging
    const logs = await this.getContainerLogs(containerId, 50);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[health] TIMEOUT after ${elapsed}s (${attempt} attempts). Container logs:\n${logs}`);
    throw new Error(`Container failed to become healthy within ${maxWaitSeconds}s. Logs:\n${logs}`);
  }

  async getContainerStats(containerId: string): Promise<{
    memoryUsage: number;
    cpuUsage: number;
  }> {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });
    
    const memoryUsage = stats.memory_stats?.usage || 0;
    const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
    const cpuUsage = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;
    
    return {
      memoryUsage: Math.round(memoryUsage / 1024 / 1024), // MB
      cpuUsage: Math.round(cpuUsage * 100) / 100, // Percentage
    };
  }

  /**
   * Execute a command inside a running container and return its output.
   * Uses the Docker API directly (no shell `docker exec` needed).
   */
  async execInContainer(containerNameOrId: string, cmd: string[], timeoutMs = 15000): Promise<string> {
    const container = docker.getContainer(containerNameOrId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false, Tty: false });
    return new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), timeoutMs);
    });
  }

  /**
   * Approve pending device pairing requests in an OpenClaw container.
   * Used when Browser tool or other in-container clients hit "pairing required".
   * Runs `openclaw devices approve` via loopback (127.0.0.1) so gateway auto-approves.
   */
  async approveDevicePairing(agentId: string, gatewayToken: string): Promise<{ approved: number }> {
    const containerName = `openclaw-${agentId}`;
    const loopbackArgs = ['--url', 'ws://127.0.0.1:18789', '--token', gatewayToken];

    // openclaw-secure image uses node /opt/openclaw/openclaw.mjs (no global openclaw binary)
    const openclawCmds: ((args: string[]) => string[])[] = [
      (args) => ['openclaw', ...args],
      (args) => ['/usr/local/bin/openclaw', ...args],
      (args) => ['node', '/opt/openclaw/openclaw.mjs', ...args],
    ];

    // Strategy 1: approve --latest (OpenClaw 2026.x)
    for (const cmdFactory of openclawCmds) {
      try {
        await this.execInContainer(containerName, cmdFactory(['devices', 'approve', '--latest', ...loopbackArgs]), 15000);
        return { approved: 1 };
      } catch {
        // --latest may not exist, try list + approve
      }
    }

    // Strategy 2: list devices, parse request IDs, approve each
    for (const cmdFactory of openclawCmds) {
      try {
        const output = await this.execInContainer(containerName, cmdFactory(['devices', 'list', ...loopbackArgs]), 15000);
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const matches = output.match(uuidPattern);
        if (!matches || matches.length === 0) return { approved: 0 };
        let count = 0;
        for (const rid of new Set(matches)) {
          try {
            await this.execInContainer(containerName, cmdFactory(['devices', 'approve', rid, ...loopbackArgs]), 12000);
            count++;
          } catch (err) {
            console.warn(`[docker] Failed to approve device ${rid}:`, (err as Error).message);
          }
        }
        return { approved: count };
      } catch (err) {
        console.warn(`[docker] Pairing approval attempt failed:`, (err as Error).message);
      }
    }
    throw new Error('Failed to approve device pairing');
  }

  /** List all Agenix-managed containers and return their bound host ports */
  async listManagedContainers(): Promise<number[]> {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ['agenix.managed=true'] },
    });

    const ports: number[] = [];
    for (const c of containers) {
      for (const p of (c.Ports || [])) {
        if (p.PublicPort) ports.push(p.PublicPort);
      }
    }
    return ports;
  }
}

export const dockerService = new DockerService();
