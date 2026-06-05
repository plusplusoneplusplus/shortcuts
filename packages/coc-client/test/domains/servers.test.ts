import { describe, expect, it } from 'vitest';
import { ServersClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('ServersClient', () => {
  it('calls server CRUD and health endpoints', async () => {
    const adapter = createMockAdapter({});
    const client = new ServersClient(adapter);

    await client.list();
    await client.add({ kind: 'url', label: 'Test', url: 'http://localhost:4000' });
    await client.update('s1', { label: 'Updated' });
    await client.remove('s1');
    await client.test({ kind: 'url', label: 'Test', url: 'http://localhost:4000' });
    await client.reconnect('s1');
    await client.getHealth('s1');
    await client.cherryPickTransfer({
      source: { serverId: 'source/server', workspaceId: 'source/ws', commitHash: 'abc123' },
      target: { serverId: 'target/server', workspaceId: 'target/ws', stashAndContinue: true },
    });

    expect(adapter.calls).toMatchObject([
      { path: '/servers' },
      {
        path: '/servers',
        options: { method: 'POST', body: { kind: 'url', label: 'Test', url: 'http://localhost:4000' } },
      },
      {
        path: '/servers/s1',
        options: { method: 'PATCH', body: { label: 'Updated' } },
      },
      {
        path: '/servers/s1',
        options: { method: 'DELETE' },
      },
      {
        path: '/servers/test',
        options: { method: 'POST', body: { kind: 'url', label: 'Test', url: 'http://localhost:4000' } },
      },
      {
        path: '/servers/s1/reconnect',
        options: { method: 'POST' },
      },
      {
        path: '/servers/s1/health',
      },
      {
        path: '/servers/cherry-pick-transfer',
        options: {
          method: 'POST',
          body: {
            source: { serverId: 'source/server', workspaceId: 'source/ws', commitHash: 'abc123' },
            target: { serverId: 'target/server', workspaceId: 'target/ws', stashAndContinue: true },
          },
        },
      },
    ]);
  });

  it('encodes server IDs with special characters', async () => {
    const adapter = createMockAdapter({});
    const client = new ServersClient(adapter);

    await client.update('id/with spaces', { label: 'x' });
    await client.remove('id/with spaces');
    await client.reconnect('id/with spaces');
    await client.getHealth('id/with spaces');

    const paths = adapter.calls.map(c => c.path);
    const encoded = encodeURIComponent('id/with spaces');
    expect(paths).toEqual([
      `/servers/${encoded}`,
      `/servers/${encoded}`,
      `/servers/${encoded}/reconnect`,
      `/servers/${encoded}/health`,
    ]);
  });
});
