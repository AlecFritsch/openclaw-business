// Security Service - Implements fixes for OpenClaw CVEs + config hardening

import { config } from '../config/env.js';
import type { OpenClawFullConfig } from '@openclaw-business/shared';

/**
 * CVE-2026-25253: Token Exfiltration via gatewayUrl Auto-Connect
 * Fix: Validate gateway URLs against allowlist
 */
export function validateGatewayUrl(url: string): boolean {
  const allowlist = config.gatewayAllowlist;
  
  if (allowlist.length === 0) {
    // No allowlist configured - allow localhost only
    return url.startsWith('ws://localhost') || url.startsWith('ws://127.0.0.1');
  }
  
  return allowlist.some(allowed => url.startsWith(allowed));
}

/**
 * CVE-2026-24763: Docker Sandbox Command Injection via PATH
 * Fix: Sanitize PATH environment variable
 */
export function sanitizePath(path: string): string {
  // Remove any suspicious path entries
  const pathEntries = path.split(':');
  const safePaths = pathEntries.filter(entry => {
    // Only allow standard system paths
    return entry.startsWith('/usr/') || 
           entry.startsWith('/bin/') || 
           entry.startsWith('/sbin/') ||
           entry === '/usr/local/bin';
  });
  
  return safePaths.join(':');
}

/**
 * CVE-2026-25157: SSH Mode Command Injection
 * Fix: Disable SSH mode entirely for managed deployments
 */
export function hardenOpenClawConfig(baseConfig: OpenClawFullConfig): OpenClawFullConfig {
  return {
    ...baseConfig,
    gateway: {
      ...baseConfig.gateway,
      mode: 'local', // Never use remote/SSH mode for managed deployments
    },
    tools: {
      ...baseConfig.tools,
      elevated: {
        enabled: false,
        mode: 'off',
      },
      exec: {
        ...baseConfig.tools?.exec,
        // Cap timeout for managed agents
        timeoutSec: Math.min(baseConfig.tools?.exec?.timeoutSec || 300, 600),
      },
    },
    browser: {
      ...baseConfig.browser,
      enabled: false, // No browser in containers
    },
  };
}

/**
 * Legacy adapter: wraps old-style config into new format
 * @deprecated Use hardenOpenClawConfig with OpenClawFullConfig
 */
export function getSecureOpenClawConfig(baseConfig: any): any {
  return {
    ...baseConfig,
    // Disable SSH mode
    ssh: {
      enabled: false,
    },
    // Enforce sandbox mode
    sandbox: {
      mode: 'always',
      image: config.openclawImageTag,
    },
    // Shell execution controls
    tools: {
      ...baseConfig.tools,
      autoApprove: false,
    },
    // Network egress controls
    network: {
      egress: {
        allowlist: config.networkEgressAllowlist,
        denyAll: config.networkEgressAllowlist.length > 0,
      },
    },
  };
}

/**
 * Validate skill source before installation
 * Prevents malicious skill injection
 */
export function validateSkillSource(skillName: string, source: string): boolean {
  const trustedSources = [
    'https://github.com/openclaw/skills',
    'https://registry.openclaw.io',
    'https://clawhub.ai',
    'https://clawhub.com',
  ];
  
  return trustedSources.some(trusted => source.startsWith(trusted));
}

/**
 * Validate channel credentials format
 */
export function validateChannelCredentials(channelType: string, credentials: any): { valid: boolean; error?: string } {
  switch (channelType) {
    case 'telegram':
      if (!credentials?.botToken || typeof credentials.botToken !== 'string') {
        return { valid: false, error: 'Telegram requires a valid bot token' };
      }
      // Basic Telegram token format: number:alphanumeric
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(credentials.botToken)) {
        return { valid: false, error: 'Invalid Telegram bot token format' };
      }
      return { valid: true };

    case 'discord':
      if (!credentials?.botToken || typeof credentials.botToken !== 'string') {
        return { valid: false, error: 'Discord requires a valid bot token' };
      }
      return { valid: true };

    case 'slack':
      if (!credentials?.botToken || typeof credentials.botToken !== 'string') {
        return { valid: false, error: 'Slack requires a bot token (xoxb-...)' };
      }
      if (!credentials.botToken.startsWith('xoxb-')) {
        return { valid: false, error: 'Slack bot token must start with xoxb-' };
      }
      return { valid: true };

    case 'whatsapp':
      // WhatsApp uses QR pairing, no token needed upfront
      return { valid: true };

    case 'webchat':
      // WebChat has no credentials
      return { valid: true };

    case 'signal':
      if (!credentials?.phoneNumber || typeof credentials.phoneNumber !== 'string') {
        return { valid: false, error: 'Signal requires a phone number' };
      }
      return { valid: true };

    case 'imessage':
      // iMessage: valid without credentials (local macOS) OR needs BlueBubbles bridge
      if (credentials?.bridgeUrl || credentials?.bridgePassword) {
        if (!credentials.bridgeUrl || typeof credentials.bridgeUrl !== 'string') {
          return { valid: false, error: 'iMessage bridge requires a valid bridge URL' };
        }
        if (!credentials.bridgePassword || typeof credentials.bridgePassword !== 'string') {
          return { valid: false, error: 'iMessage bridge requires a valid bridge password' };
        }
      }
      return { valid: true };

    case 'googlechat':
      if (!credentials?.serviceAccountKey || typeof credentials.serviceAccountKey !== 'string') {
        return { valid: false, error: 'Google Chat requires a service account key' };
      }
      return { valid: true };

    case 'msteams':
      if (!credentials?.appId || typeof credentials.appId !== 'string') {
        return { valid: false, error: 'MS Teams requires an app ID' };
      }
      if (!credentials?.appSecret || typeof credentials.appSecret !== 'string') {
        return { valid: false, error: 'MS Teams requires an app secret' };
      }
      return { valid: true };

    case 'mattermost':
      if (!credentials?.url || typeof credentials.url !== 'string') {
        return { valid: false, error: 'Mattermost requires a server URL' };
      }
      if (!credentials?.token || typeof credentials.token !== 'string') {
        return { valid: false, error: 'Mattermost requires a bot token' };
      }
      return { valid: true };

    case 'matrix':
      if (!credentials?.homeserverUrl || typeof credentials.homeserverUrl !== 'string') {
        return { valid: false, error: 'Matrix requires a homeserver URL' };
      }
      if (!credentials?.accessToken || typeof credentials.accessToken !== 'string') {
        return { valid: false, error: 'Matrix requires an access token' };
      }
      return { valid: true };

    case 'feishu':
      if (!credentials?.appId || typeof credentials.appId !== 'string') {
        return { valid: false, error: 'Feishu requires an app ID' };
      }
      if (!credentials?.appSecret || typeof credentials.appSecret !== 'string') {
        return { valid: false, error: 'Feishu requires an app secret' };
      }
      return { valid: true };

    case 'line':
      if (!credentials?.channelAccessToken || typeof credentials.channelAccessToken !== 'string') {
        return { valid: false, error: 'LINE requires a channel access token' };
      }
      if (!credentials?.channelSecret || typeof credentials.channelSecret !== 'string') {
        return { valid: false, error: 'LINE requires a channel secret' };
      }
      return { valid: true };

    case 'bluebubbles':
      if (!credentials?.bridgeUrl || typeof credentials.bridgeUrl !== 'string') {
        return { valid: false, error: 'BlueBubbles requires a bridge URL' };
      }
      if (!credentials?.bridgePassword || typeof credentials.bridgePassword !== 'string') {
        return { valid: false, error: 'BlueBubbles requires a bridge password' };
      }
      return { valid: true };

    case 'superchat':
      if (!credentials?.apiKey || typeof credentials.apiKey !== 'string') {
        return { valid: false, error: 'Superchat requires an API key' };
      }
      if (credentials.apiKey.trim().length < 10) {
        return { valid: false, error: 'Superchat API key appears invalid' };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unsupported channel type: ${channelType}` };
  }
}

/**
 * Generate secure Docker run command (for reference/debugging)
 */
export function generateSecureDockerCommand(params: {
  containerName: string;
  workspacePath: string;
  gatewayPort: number;
  agentId: string;
}): string {
  const { containerName, workspacePath, gatewayPort, agentId } = params;
  
  const securePath = '/usr/local/bin:/usr/bin:/bin';
  
  // NOTE: API keys are passed via Docker env-file or secrets in production.
  // Never interpolate real secrets into command strings that may be logged.
  return `docker run -d \\
    --name ${containerName} \\
    --network openclaw-network \\
    --network-alias ${agentId} \\
    -p 127.0.0.1:${gatewayPort}:18789 \\
    -v ${workspacePath}:/root/.openclaw:ro \\
    -e PATH=${securePath} \\
    -e OPENCLAW_GATEWAY_TOKEN=\${GATEWAY_TOKEN} \\
    --read-only \\
    --tmpfs /tmp:rw,noexec,nosuid,size=100m \\
    --security-opt=no-new-privileges:true \\
    --cap-drop=ALL \\
    --cap-add=NET_BIND_SERVICE \\
    --memory=2g \\
    --cpus=1.0 \\
    --pids-limit=100 \\
    --restart=unless-stopped \\
    ${config.openclawImageTag} \\
    openclaw gateway`;
}

/**
 * Audit log for security events
 */
export interface SecurityAuditLog {
  timestamp: Date;
  agentId: string;
  userId: string;
  event: 'gateway_url_blocked' | 'shell_command_blocked' | 'skill_blocked' | 'network_egress_blocked' | 'credential_validation_failed';
  details: any;
}

export function logSecurityEvent(log: SecurityAuditLog): void {
  // In production: Send to Cloud Logging or security SIEM
  console.warn('[SECURITY]', JSON.stringify(log));
}

/**
 * Rate limiting per organization
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(orgId: string, limit: number = 100, windowMs: number = 60000): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(orgId);
  
  if (!record || now > record.resetAt) {
    rateLimitStore.set(orgId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (record.count >= limit) {
    return false;
  }
  
  record.count++;
  return true;
}
