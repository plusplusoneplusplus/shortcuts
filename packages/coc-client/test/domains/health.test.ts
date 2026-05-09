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

  it('passes signal option through to transport', async () => {
    const adapter = createMockAdapter({ status: 'ok' });
    const client = new HealthClient(adapter);
    const controller = new AbortController();

    await client.get({ signal: controller.signal });

    expect(adapter.calls[0].options).toMatchObject({ signal: controller.signal });
  });
});
