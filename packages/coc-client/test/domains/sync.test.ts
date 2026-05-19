import { describe, expect, it } from 'vitest';
import { SyncClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('SyncClient', () => {
  it('getStatus calls GET /sync/status', async () => {
    const adapter = createMockAdapter({ enabled: true, inProgress: false, lastSyncTime: null, lastError: null });
    const client = new SyncClient(adapter);

    const result = await client.getStatus();

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].path).toBe('/sync/status');
    expect(result.enabled).toBe(true);
  });

  it('trigger calls POST /sync/trigger', async () => {
    const adapter = createMockAdapter({ enabled: true, inProgress: false, lastSyncTime: '2026-01-01T00:00:00Z', lastError: null });
    const client = new SyncClient(adapter);

    const result = await client.trigger();

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].path).toBe('/sync/trigger');
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST' });
    expect(result.lastSyncTime).toBe('2026-01-01T00:00:00Z');
  });
});
