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

  it('reads turn performance stats with dimension and filter queries', async () => {
    const adapter = createMockAdapter({
      groups: [],
      groupBy: ['provider'],
      days: null,
      totalEvents: 0,
      excludedEvents: { nonCompleted: 0, noFirstToken: 0, noTokenUsage: 0 },
      generatedAt: '2026-08-20T00:00:00.000Z',
    });
    const client = new StatsClient(adapter);

    await client.turnPerformance();
    await client.turnPerformance({ days: 7, groupBy: ['provider', 'model'], firstTurnOnly: true });
    await client.turnPerformance({ processId: 'p42', firstTurnOnly: false });

    expect(adapter.calls).toEqual([
      { path: '/stats/turn-performance', options: { query: undefined } },
      {
        path: '/stats/turn-performance',
        options: {
          query: { days: 7, groupBy: ['provider', 'model'], firstTurnOnly: 1, processId: undefined },
        },
      },
      {
        path: '/stats/turn-performance',
        options: {
          query: { days: undefined, groupBy: undefined, firstTurnOnly: undefined, processId: 'p42' },
        },
      },
    ]);
  });
});
