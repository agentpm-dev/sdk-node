import { describe, it, expect } from 'vitest';

import { hello } from '../src';

describe('sdk', () => {
  it('boots', () => {
    expect(hello()).toBe('agentpm-sdk ready');
  });
});
