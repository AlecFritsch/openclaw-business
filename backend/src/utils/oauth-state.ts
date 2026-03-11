/**
 * OAuth state signing/verification — prevents CSRF on callback redirects.
 * State format: base64(json).base64(hmac)
 */

import crypto from 'crypto';
import { config } from '../config/env.js';

const ALG = 'sha256';

function getSigningKey(): Buffer {
  if (!config.encryptionKey) throw new Error('ENCRYPTION_KEY required for OAuth state signing');
  return crypto.createHmac(ALG, config.encryptionKey).digest();
}

export function signOAuthState(payload: { orgId?: string; agentId?: string; userId?: string }): string {
  const raw = JSON.stringify(payload);
  const b64 = Buffer.from(raw, 'utf8').toString('base64url');
  const sig = crypto.createHmac(ALG, getSigningKey()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyOAuthState(state: string): { orgId?: string; agentId?: string; userId?: string } | null {
  if (!state || !config.encryptionKey) return null;
  const idx = state.lastIndexOf('.');
  if (idx < 0) return null;
  const [b64, sig] = [state.slice(0, idx), state.slice(idx + 1)];
  const expected = crypto.createHmac(ALG, getSigningKey()).update(b64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))) {
    return null;
  }
  try {
    const raw = Buffer.from(b64, 'base64url').toString('utf8');
    return JSON.parse(raw) as { orgId?: string; agentId?: string; userId?: string };
  } catch {
    return null;
  }
}

/** Valid ObjectId = 24 hex chars. Empty string allowed. */
export function sanitizeAgentId(agentId: string | undefined): string {
  if (!agentId || typeof agentId !== 'string') return '';
  const trimmed = agentId.trim();
  if (trimmed.length === 0) return '';
  if (/^[a-fA-F0-9]{24}$/.test(trimmed)) return trimmed;
  return '';
}
