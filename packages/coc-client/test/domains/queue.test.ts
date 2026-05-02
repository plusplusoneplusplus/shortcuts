import { describe, expect, it } from 'vitest';
import { QueueClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('QueueClient', () => {
  it('calls queue list, stats, enqueue, and control endpoints', async () => {
    const adapter = createMockAdapter({ stats: {} });
    const client = new QueueClient(adapter);

    await client.list({ workspace: 'repo/a', type: 'chat' });
    await client.stats({ workspace: 'repo/a' });
    await client.enqueue({ type: 'chat', payload: { prompt: 'hi' } });
    await client.pause('repo/a');
    await client.cancel('task/1');

    expect(adapter.calls.map(c => c.path)).toEqual(['/queue', '/queue/stats', '/queue', '/queue/pause', '/queue/task%2F1']);
    expect(adapter.calls[0].options?.query).toEqual({ workspace: 'repo/a', type: 'chat' });
    expect(adapter.calls[2].options?.body).toEqual({ type: 'chat', payload: { prompt: 'hi' } });
  });
});
