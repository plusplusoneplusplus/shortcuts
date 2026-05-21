import { describe, expect, it } from 'vitest';
import { SyncClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('SyncClient', () => {
  it('getStatus calls GET /workspaces/:workspaceId/sync/status', async () => {
    const adapter = createMockAdapter({ enabled: true, inProgress: false, lastSyncTime: null, lastError: null });
    const client = new SyncClient(adapter);

    const result = await client.getStatus('my_work');

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].path).toBe('/workspaces/my_work/sync/status');
    expect(result.enabled).toBe(true);
  });

  it('trigger calls POST /workspaces/:workspaceId/sync/trigger', async () => {
    const adapter = createMockAdapter({ enabled: true, inProgress: false, lastSyncTime: '2026-01-01T00:00:00Z', lastError: null });
    const client = new SyncClient(adapter);

    const result = await client.trigger('my_life');

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].path).toBe('/workspaces/my_life/sync/trigger');
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST' });
    expect(result.lastSyncTime).toBe('2026-01-01T00:00:00Z');
  });

  it('encodes workspaceId in URL', async () => {
    const adapter = createMockAdapter({ enabled: false, inProgress: false, lastSyncTime: null, lastError: null });
    const client = new SyncClient(adapter);

    await client.getStatus('workspace/special');

    expect(adapter.calls[0].path).toBe('/workspaces/workspace%2Fspecial/sync/status');
  });
});
