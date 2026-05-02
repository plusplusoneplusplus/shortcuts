import { describe, expect, it } from 'vitest';
import { SeenStateClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('SeenStateClient', () => {
  it('calls seen-state endpoints with encoded workspace and process IDs', async () => {
    const adapter = createMockAdapter({ unseenCount: 2 });
    const client = new SeenStateClient(adapter);
    const entries = [{ processId: 'proc/1 snow/雪%done', seenAt: '2026-05-02T00:00:00.000Z' }];

    await client.getMap('repo/a space/雪%done');
    await client.updateMany('repo/a space/雪%done', entries);
    await client.markUnseen('repo/a space/雪%done', 'proc/1 snow/雪%done');
    await client.getUnseenCount('repo/a space/雪%done');

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/seen-state' },
      {
        path: '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/seen-state',
        options: { method: 'PATCH', body: { entries } },
      },
      {
        path: '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/seen-state/proc%2F1%20snow%2F%E9%9B%AA%25done',
        options: { method: 'DELETE' },
      },
      { path: '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/seen-state/count' },
    ]);
  });

  it('copies batch update entries before sending the request body', async () => {
    const adapter = createMockAdapter({});
    const client = new SeenStateClient(adapter);
    const entries = [{ processId: 'proc-1', seenAt: '2026-05-02T00:00:00.000Z' }];

    await client.updateMany('repo-a', entries);
    entries[0].seenAt = 'mutated';

    expect(adapter.calls[0].options?.body).toEqual({
      entries: [{ processId: 'proc-1', seenAt: '2026-05-02T00:00:00.000Z' }],
    });
  });
});
