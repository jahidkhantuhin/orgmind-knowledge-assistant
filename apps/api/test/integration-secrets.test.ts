import { describe, expect, it } from 'vitest';
import {
  decryptIntegrationToken,
  encryptIntegrationToken,
} from '../src/modules/integrations/integration-secrets.js';

describe('integration credential encryption', () => {
  it('encrypts tokens at rest and decrypts them for the MCP client', () => {
    const token = 'github_pat_test_value_never_use_a_real_credential';
    const encrypted = encryptIntegrationToken(token);

    expect(encrypted).not.toContain(token);
    expect(encrypted.split('.')).toHaveLength(3);
    expect(decryptIntegrationToken(encrypted)).toBe(token);
  });

  it('rejects ciphertext that has been changed', () => {
    const encrypted = encryptIntegrationToken('synthetic-test-token');
    const [iv, tag, cipherText] = encrypted.split('.');

    expect(() => decryptIntegrationToken(`${iv}.${tag}.${cipherText}x`)).toThrow();
  });
});
