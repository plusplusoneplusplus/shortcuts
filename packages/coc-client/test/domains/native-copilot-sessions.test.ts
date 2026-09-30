import { describe, expect, it } from 'vitest';
import { NativeCopilotSessionsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('NativeCopilotSessionsClient', () => {
  it('passes the list scope option through as a query param', async () => {
    const adapter = createMockAdapter({ enabled: true, items: [], total: 0, limit: 20, offset: 0 });
    const client = new NativeCopilotSessionsClient(adapter);

    await client.list('ws/1', { q: 'login', scope: 'all', limit: 20 });

    expect(adapter.calls[0].path).toBe('/workspaces/ws%2F1/native-copilot-sessions');
    expect(adapter.calls[0].options?.query).toMatchObject({ q: 'login', scope: 'all', limit: 20 });
  });

  it('POSTs import to the session import endpoint', async () => {
    const adapter = createMockAdapter({ processId: 'queue_1', created: true });
    const client = new NativeCopilotSessionsClient(adapter);

    const result = await client.import('ws-1', 'native/abc');

    expect(result).toEqual({ processId: 'queue_1', created: true });
    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/ws-1/native-copilot-sessions/native%2Fabc/import',
      options: { method: 'POST' },
    });
  });
});
