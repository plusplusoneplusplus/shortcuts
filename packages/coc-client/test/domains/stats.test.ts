import { describe, expect, it } from 'vitest';
import { StatsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('StatsClient', () => {
  it('reads token usage stats with an optional days query', async () => {
    const adapter = createMockAdapter({ entries: [], models: [], generatedAt: '2026-05-02T00:00:00.000Z', totalDays: 0 });
    const client = new StatsClient(adapter);

    await client.tokenUsage();
    await client.tokenUsage({ days: 30 });

    expect(adapter.calls).toEqual([
      { path: '/stats/token-usage', options: { query: undefined } },
      { path: '/stats/token-usage', options: { query: { days: 30 } } },
    ]);
  });
});
