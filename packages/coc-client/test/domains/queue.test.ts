import { describe, expect, it } from 'vitest';
import { QueueClient, type QueuePauseMarkerResponse } from '../../src';
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
    await client.pause('repo/a', { durationHours: 1 });
    await client.pause({ repoId: 'repo/b' }, { durationHours: 2 });
    await client.pauseAutopilot({ repoId: 'repo/b' }, { durationHours: 3 });
    await client.insertPauseMarker({ afterIndex: 0, repoId: 'repo/a', durationHours: 2 });
    await client.cancel('task/1');
    await client.moveToTop('task/1');
    await client.summarize({
      processIds: ['proc/1', 'proc/2'],
      workspaceId: 'repo/a',
      userPrompt: 'focus on risks',
      lensChat: { inherited: true, source: 'features.commitChatLens' },
    });

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/queue',
      '/queue/stats',
      '/queue',
      '/queue/task%2F1',
      '/queue/task%2F1/images',
      '/queue/task%2F1/resolved-prompt',
      '/queue/pause',
      '/queue/pause',
      '/queue/pause-autopilot',
      '/queue/pause-marker',
      '/queue/task%2F1',
      '/queue/task%2F1/move-to-top',
      '/queue/summarize',
    ]);
    expect(adapter.calls[0].options?.query).toEqual({ workspace: 'repo/a', type: 'chat' });
    expect(adapter.calls[2].options?.body).toEqual({ type: 'chat', payload: { prompt: 'hi' } });
    expect(adapter.calls[6].options?.body).toEqual({ durationHours: 1 });
    expect(adapter.calls[7].options?.query).toEqual({ repoId: 'repo/b' });
    expect(adapter.calls[7].options?.body).toEqual({ durationHours: 2 });
    expect(adapter.calls[8].options?.query).toEqual({ repoId: 'repo/b' });
    expect(adapter.calls[8].options?.body).toEqual({ durationHours: 3 });
    expect(adapter.calls[9].options?.body).toEqual({ afterIndex: 0, repoId: 'repo/a', durationHours: 2 });
    expect(adapter.calls[12].options).toMatchObject({
      method: 'POST',
      body: {
        processIds: ['proc/1', 'proc/2'],
        workspaceId: 'repo/a',
        userPrompt: 'focus on risks',
        lensChat: { inherited: true, source: 'features.commitChatLens' },
      },
    });
  });

  it('posts to the retry endpoint with the encoded task id', async () => {
    const adapter = createMockAdapter({ task: { id: 'new-1', status: 'queued' } });
    const client = new QueueClient(adapter);

    await client.retry('task/1');

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].path).toBe('/queue/task%2F1/retry');
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST' });
  });

  it('returns timed pause marker response duration', async () => {
    const response = {
      markerId: 'marker-1',
      afterIndex: 0,
      durationHours: 2,
    } satisfies QueuePauseMarkerResponse;
    const adapter = createMockAdapter(response);
    const client = new QueueClient(adapter);

    await expect(client.insertPauseMarker({ afterIndex: 0, durationHours: 2 })).resolves.toEqual(response);
  });
});
