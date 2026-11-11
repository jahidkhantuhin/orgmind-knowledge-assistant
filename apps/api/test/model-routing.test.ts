import { describe, expect, it } from 'vitest';
import { routeChatModel } from '../src/modules/chat/model-routing.js';

describe('chat model routing', () => {
  it('uses the automatic route for straightforward questions', () => {
    expect(routeChatModel('How many sick leave days are allowed?')).toMatchObject({
      preference: 'auto',
      route: 'fast',
    });
  });

  it('routes multi-part and analytical questions to the stronger model', () => {
    expect(
      routeChatModel('Compare the parental and sick leave policies, and explain their trade-offs.'),
    ).toMatchObject({ route: 'strong' });
  });

  it('respects explicit fast and strong selections', () => {
    expect(routeChatModel('Compare both policies.', 'fast').route).toBe('fast');
    expect(routeChatModel('What is the policy code?', 'strong').route).toBe('strong');
  });
});
