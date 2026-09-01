import { describe, expect, it } from 'vitest';
import { WorkspacesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('WorkspacesClient', () => {
  it('calls workspace list, registration, discovery, git info, and history routes', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.list();
    await client.register({ id: 'repo/a', name: 'Repo', rootPath: 'C:\\repo' });
    await client.getActiveWorkspaces();
    await client.reportActiveWorkspace({ clientId: 'dashboard-tab', workspaceId: 'repo/a' });
    await client.discover('C:\\repos');
    await client.browseFolders('C:\\repos', { showHidden: true });
    await client.summary('repo/a', { folder: 'workflows', showArchived: true });
    await client.gitInfo('repo/a');
    await client.gitInfoBatch(['repo/a', 'repo/b']);
    await client.getMcpConfig('repo/a');
    await client.getMcpConfig('repo/a', { forceReload: true });
    await client.updateMcpConfig('repo/a', { enabledMcpServers: ['github'] });
    await client.getInstructions('repo/a');
    await client.updateInstruction('repo/a', 'ask', { content: 'Ask carefully' });
    await client.deleteInstruction('repo/a', 'ask');
    await client.history('repo/a', { limit: 100, offset: 200 });
    await client.deleteHistory('repo/a', 'proc/1');
    await client.syncMyWork({ actionItems: ['Review PR'] });
    await client.generateMyWorkSummary();
    await client.syncMyLife({ goals: ['Exercise'] });
    await client.generateMyLifeSummary();

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces',
      '/workspaces',
      '/workspaces/active',
      '/workspaces/active',
      '/workspaces/discover',
      '/fs/browse',
      '/workspaces/repo%2Fa/summary',
      '/workspaces/repo%2Fa/git-info',
      '/git-info/batch',
      '/workspaces/repo%2Fa/mcp-config',
      '/workspaces/repo%2Fa/mcp-config',
      '/workspaces/repo%2Fa/mcp-config',
      '/workspaces/repo%2Fa/instructions',
      '/workspaces/repo%2Fa/instructions/ask',
      '/workspaces/repo%2Fa/instructions/ask',
      '/workspaces/repo%2Fa/history',
      '/workspaces/repo%2Fa/history/proc%2F1',
      '/my-work/sync',
      '/my-work/generate-summary',
      '/my-life/sync',
      '/my-life/generate-summary',
    ]);
    expect(adapter.calls[3].options).toMatchObject({
      method: 'POST',
      body: { clientId: 'dashboard-tab', workspaceId: 'repo/a' },
    });
    expect(adapter.calls[4].options?.query).toEqual({ path: 'C:\\repos' });
    expect(adapter.calls[5].options?.query).toEqual({ path: 'C:\\repos', showHidden: true });
    expect(adapter.calls[6].options?.query).toEqual({ folder: 'workflows', showArchived: true });
    expect(adapter.calls[8].options).toMatchObject({
      method: 'POST',
      body: { workspaceIds: ['repo/a', 'repo/b'] },
    });
    expect(adapter.calls[10].options?.query).toEqual({ forceReload: true });
    expect(adapter.calls[11].options).toMatchObject({
      method: 'PUT',
      body: { enabledMcpServers: ['github'] },
    });
    expect(adapter.calls[13].options).toMatchObject({
      method: 'PUT',
      body: { content: 'Ask carefully' },
    });
    expect(adapter.calls[14].options).toMatchObject({ method: 'DELETE' });
    expect(adapter.calls[15].options?.query).toEqual({ limit: 100, offset: 200 });
    expect(adapter.calls[17].options).toMatchObject({
      method: 'POST',
      body: { actionItems: ['Review PR'] },
    });
    expect(adapter.calls[19].options).toMatchObject({
      method: 'POST',
      body: { goals: ['Exercise'] },
    });
  });

  it('encodes workspace and history IDs with special characters once', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.gitInfo('repo/a space/雪%done');
    await client.getMcpConfig('repo/a space/雪%done');
    await client.updateInstruction('repo/a space/雪%done', 'plan', { content: 'Plan' });
    await client.deleteHistory('repo/a space/雪%done', 'proc/1 snow/雪%done');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/git-info',
      '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/mcp-config',
      '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/instructions/plan',
      '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/history/proc%2F1%20snow%2F%E9%9B%AA%25done',
    ]);
  });

  it('serializes Ralph resume AI overrides', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.resumeRalphSession('repo/a', 'sess/1', {
      provider: 'claude',
      config: {
        model: 'claude-sonnet-4.6',
        reasoningEffort: 'high',
        effortTier: 'low',
      },
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/resume',
      options: {
        method: 'POST',
        body: {
          provider: 'claude',
          config: {
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            effortTier: 'low',
          },
        },
      },
    });
  });

  it('keeps Ralph resume body empty when no overrides are provided', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.resumeRalphSession('repo/a', 'sess/1');

    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/resume',
      options: { method: 'POST' },
    });
  });

  it('serializes Ralph resume Auto routing without a concrete provider', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.resumeRalphSession('repo/a', 'sess/1', {
      autoProviderRouting: true,
      config: { effortTier: 'medium' },
    });

    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/resume',
      options: {
        method: 'POST',
        body: {
          config: { effortTier: 'medium' },
          autoProviderRouting: true,
        },
      },
    });
  });

  it('serializes Ralph continue AI overrides alongside additionalIterations', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.continueRalphSession('repo/a', 'sess/1', {
      additionalIterations: 20,
      provider: 'claude',
      config: {
        model: 'claude-sonnet-4.6',
        reasoningEffort: 'high',
        effortTier: 'low',
      },
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/continue',
      options: {
        method: 'POST',
        body: {
          additionalIterations: 20,
          provider: 'claude',
          config: {
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            effortTier: 'low',
          },
        },
      },
    });
  });

  it('serializes Ralph continue Auto routing without a concrete provider', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.continueRalphSession('repo/a', 'sess/1', {
      additionalIterations: 5,
      autoProviderRouting: true,
      config: { effortTier: 'medium' },
    });

    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/continue',
      options: {
        method: 'POST',
        body: {
          additionalIterations: 5,
          config: { effortTier: 'medium' },
          autoProviderRouting: true,
        },
      },
    });
  });

  it('keeps the Ralph continue body minimal when no overrides are provided', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.continueRalphSession('repo/a', 'sess/1', { additionalIterations: 20 });

    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/continue',
      options: {
        method: 'POST',
        body: { additionalIterations: 20 },
      },
    });
  });

  it('submits a completed Ralph session as a PR with an empty POST body', async () => {
    const adapter = createMockAdapter({
      submitted: true,
      sessionId: 'sess/1',
      taskId: 'task-9',
      submitIndex: 2,
    });
    const client = new WorkspacesClient(adapter);

    const response = await client.submitRalphPr('repo/a', 'sess/1');

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/ralph-sessions/sess%2F1/submit-pr',
      options: { method: 'POST' },
    });
    expect(response.submitted).toBe(true);
    expect(response.sessionId).toBe('sess/1');
    expect(response.taskId).toBe('task-9');
    expect(response.submitIndex).toBe(2);
  });
});

/**
 * `updateMcpConfig` is a PARTIAL patch: the enabled-server list and the
 * enabled-tools allow-list have separate persistence owners on the server, and
 * each is applied by property PRESENCE. A caller mutating only tools must be
 * able to leave the server list out entirely — sending a stale server snapshot
 * alongside a tool save is what let an older write revert a newer toggle.
 */
describe('WorkspacesClient.updateMcpConfig — partial MCP policy patch', () => {
  const bodyOf = async (request: Parameters<WorkspacesClient['updateMcpConfig']>[1]) => {
    const adapter = createMockAdapter({});
    await new WorkspacesClient(adapter).updateMcpConfig('repo/a', request);
    return adapter.calls[0].options?.body as Record<string, unknown>;
  };

  it('omits enabledMcpServers entirely for a tools-only patch', async () => {
    const body = await bodyOf({ enabledMcpTools: { github: ['create_issue'] } });
    expect(Object.prototype.hasOwnProperty.call(body, 'enabledMcpServers')).toBe(false);
    expect(body).toEqual({ enabledMcpTools: { github: ['create_issue'] } });
  });

  it('omits enabledMcpTools entirely for a servers-only patch', async () => {
    const body = await bodyOf({ enabledMcpServers: ['github'] });
    expect(Object.prototype.hasOwnProperty.call(body, 'enabledMcpTools')).toBe(false);
    expect(body).toEqual({ enabledMcpServers: ['github'] });
  });

  it('distinguishes an explicit null from an omitted field', async () => {
    const body = await bodyOf({ enabledMcpServers: null, enabledMcpTools: null });
    expect(body).toEqual({ enabledMcpServers: null, enabledMcpTools: null });
  });

  it('preserves an empty array and an empty allow-list entry', async () => {
    // [] means "no server enabled" and must not collapse to null; a [] entry
    // means "every tool of that server disabled".
    const body = await bodyOf({ enabledMcpServers: [], enabledMcpTools: { github: [] } });
    expect(body).toEqual({ enabledMcpServers: [], enabledMcpTools: { github: [] } });
  });

  it('copies the server list rather than sending the caller’s array by reference', async () => {
    const servers = ['github'];
    const body = await bodyOf({ enabledMcpServers: servers });
    expect(body.enabledMcpServers).toEqual(['github']);
    expect(body.enabledMcpServers).not.toBe(servers);
  });

  it('rejects an empty patch instead of sending a no-op write', async () => {
    const adapter = createMockAdapter({});
    expect(() => new WorkspacesClient(adapter).updateMcpConfig('repo/a', {})).toThrow(/at least one/);
    expect(adapter.calls).toHaveLength(0);
  });
});
