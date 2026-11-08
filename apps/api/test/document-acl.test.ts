import { describe, expect, it } from 'vitest';
import { aclTokensForPrincipal, canReadAcl } from '../src/modules/documents/document-acl.js';

describe('document access control', () => {
  it('builds principal tokens from role, user, and team membership', () => {
    expect(aclTokensForPrincipal('user-1', 'member', ['group-1'])).toEqual([
      'role:member',
      'user:user-1',
      'group:group-1',
    ]);
  });

  it('allows matching roles, individual users, or groups and rejects unrelated principals', () => {
    const memberTokens = aclTokensForPrincipal('user-1', 'member', ['group-1']);
    expect(canReadAcl(['role:member'], memberTokens)).toBe(true);
    expect(canReadAcl(['user:user-1'], memberTokens)).toBe(true);
    expect(canReadAcl(['group:group-1'], memberTokens)).toBe(true);
    expect(canReadAcl(['user:user-2'], memberTokens)).toBe(false);
    expect(canReadAcl(['role:viewer'], memberTokens)).toBe(false);
  });
});
