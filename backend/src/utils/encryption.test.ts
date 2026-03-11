// ── Encryption Tests ─────────────────────────────────────────────
// Critical: If encrypt/decrypt breaks, all stored API keys are lost.

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './encryption.js';

describe('encryption', () => {
  it('roundtrip: encrypt then decrypt returns original', () => {
    const secrets = [
      'sk-ant-api03-abc123',
      'sk-proj-openai-xyz789',
      '',
      'a',
      '🔑 unicode key with émojis',
      'x'.repeat(10000), // large payload
    ];
    for (const secret of secrets) {
      expect(decrypt(encrypt(secret))).toBe(secret);
    }
  });

  it('GCM format: output starts with gcm: prefix', () => {
    const encrypted = encrypt('test');
    expect(encrypted.startsWith('gcm:')).toBe(true);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(4); // gcm, iv, authTag, ciphertext
  });

  it('unique IVs: same plaintext produces different ciphertext', () => {
    const a = encrypt('same-secret');
    const b = encrypt('same-secret');
    expect(a).not.toBe(b); // random IV each time
    // But both decrypt to the same value
    expect(decrypt(a)).toBe('same-secret');
    expect(decrypt(b)).toBe('same-secret');
  });

  it('tampered ciphertext throws (GCM auth tag)', () => {
    const encrypted = encrypt('sensitive-data');
    // Flip a character in the ciphertext portion
    const parts = encrypted.split(':');
    const tampered = parts[3][0] === 'a' ? 'b' + parts[3].slice(1) : 'a' + parts[3].slice(1);
    const bad = `${parts[0]}:${parts[1]}:${parts[2]}:${tampered}`;
    expect(() => decrypt(bad)).toThrow();
  });

  it('tampered auth tag throws', () => {
    const encrypted = encrypt('data');
    const parts = encrypted.split(':');
    const badTag = '0'.repeat(parts[2].length);
    const bad = `${parts[0]}:${parts[1]}:${badTag}:${parts[3]}`;
    expect(() => decrypt(bad)).toThrow();
  });

  it('invalid format throws', () => {
    expect(() => decrypt('gcm:bad')).toThrow('Invalid GCM encrypted format');
    expect(() => decrypt('gcm:a:b')).toThrow('Invalid GCM encrypted format');
  });

  it('legacy CBC format: decrypt handles old iv:ciphertext format', () => {
    // Simulate a legacy CBC-encrypted value by encrypting with CBC directly
    const crypto = require('crypto');
    const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY!).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update('legacy-secret', 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const legacyFormat = `${iv.toString('hex')}:${encrypted}`;

    // decrypt() should auto-detect CBC and handle it
    expect(decrypt(legacyFormat)).toBe('legacy-secret');
  });
});
