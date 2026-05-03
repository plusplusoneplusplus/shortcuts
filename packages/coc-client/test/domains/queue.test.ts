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
    await client.getTask('task/1');
    await client.images('task/1');
    await client.resolvedPrompt('task/1');
    await client.pause('repo/a');
    await client.pause({ repoId: 'repo/b' });
    await client.cancel('task/1');
    await client.moveToTop('task/1');
    await client.summarize({ processIds: ['proc/1', 'proc/2'], workspaceId: 'repo/a', userPrompt: 'focus on risks' });

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/queue',
      '/queue/stats',
      '/queue',
      '/queue/task%2F1',
      '/queue/task%2F1/images',
      '/queue/task%2F1/resolved-prompt',
      '/queue/pause',
      '/queue/pause',
      '/queue/task%2F1',
      '/queue/task%2F1/move-to-top',
      '/queue/summarize',
    ]);
    expect(adapter.calls[0].options?.query).toEqual({ workspace: 'repo/a', type: 'chat' });
    expect(adapter.calls[2].options?.body).toEqual({ type: 'chat', payload: { prompt: 'hi' } });
    expect(adapter.calls[7].options?.query).toEqual({ repoId: 'repo/b' });
    expect(adapter.calls[10].options).toMatchObject({
      method: 'POST',
      body: { processIds: ['proc/1', 'proc/2'], workspaceId: 'repo/a', userPrompt: 'focus on risks' },
    });
  });
});
