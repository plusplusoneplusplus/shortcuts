import { describe, expect, it } from 'vitest';
import { HealthClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('HealthClient', () => {
  it('calls health and OpenAPI endpoints', async () => {
    const adapter = createMockAdapter({ status: 'ok' });
    const client = new HealthClient(adapter);

    await client.get();
    await client.openApi();

    expect(adapter.calls.map(c => c.path)).toEqual(['/health', '/openapi.json']);
  });
});
