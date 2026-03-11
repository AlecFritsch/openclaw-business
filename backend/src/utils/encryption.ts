// Shared encryption helpers — AES-256-GCM (authenticated encryption)
// Migrated from AES-256-CBC (no auth tag) to GCM for tamper-proof ciphertext.
// Backward-compatible: decrypt() auto-detects legacy CBC format and reads it.
import crypto from 'crypto';
import { config } from '../config/env.js';

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_LENGTH = 12;  // 96-bit IV recommended for GCM
const GCM_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derives a 32-byte AES key from the configured encryption key.
 * Uses SHA-256 hash to ensure consistent 32-byte key regardless of input length.
 */
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

/**
 * Encrypt with AES-256-GCM (authenticated encryption).
 * Format: "gcm:" + hex(iv) + ":" + hex(authTag) + ":" + hex(ciphertext)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, deriveKey(), iv, { authTagLength: GCM_TAG_LENGTH });
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt — auto-detects GCM vs legacy CBC format.
 * - GCM format: "gcm:<iv>:<authTag>:<ciphertext>"
 * - Legacy CBC format: "<iv>:<ciphertext>"
 */
export function decrypt(encryptedText: string): string {
  if (encryptedText.startsWith('gcm:')) {
    return decryptGCM(encryptedText);
  }
  // Legacy CBC fallback
  return decryptCBC(encryptedText);
}

function decryptGCM(encryptedText: string): string {
  const parts = encryptedText.split(':');
  // parts = ["gcm", ivHex, authTagHex, ciphertextHex]
  if (parts.length !== 4) {
    throw new Error('Invalid GCM encrypted format');
  }
  const [, ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, deriveKey(), iv, { authTagLength: GCM_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function decryptCBC(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(CBC_ALGORITHM, deriveKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
