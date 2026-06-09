import { describe, expect, it } from 'vitest';
import { PreferencesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('PreferencesClient', () => {
  it('calls global and per-repo preference endpoints', async () => {
    const adapter = createMockAdapter({});
    const client = new PreferencesClient(adapter);

    await client.getGlobal();
    await client.patchGlobal({ theme: 'dark' });
    await client.getRepo('repo/a');
    await client.patchRepo('repo/a', { lastDepth: 'deep' });
    await client.recordSkillUsage('repo/a', 'impl');
    await client.recordCommitSkillUsage('repo/a', 'go-deep');
    await client.getSkillUsage('repo/a');
    await client.getCommitSkillUsage('repo/a');
    await client.getTaskSettings('repo/a');
    await client.updateTaskSettings('repo/a', { folderPaths: ['tasks', 'plans'] });
    await client.getLlmToolsConfig('repo/a');
    await client.updateLlmToolsConfig('repo/a', { disabledLlmTools: [] });
    await client.getEnDevStatus('repo/a', { refresh: true });
    await client.revalidateEnDev('repo/a');

    expect(adapter.calls).toMatchObject([
      { path: '/preferences' },
      { path: '/preferences', options: { method: 'PATCH', body: { theme: 'dark' } } },
      { path: '/workspaces/repo%2Fa/preferences' },
      { path: '/workspaces/repo%2Fa/preferences', options: { method: 'PATCH', body: { lastDepth: 'deep' } } },
      { path: '/workspaces/repo%2Fa/preferences/skill-usage', options: { method: 'PATCH', body: { skillName: 'impl' } } },
      { path: '/workspaces/repo%2Fa/preferences/commit-skill-usage', options: { method: 'PATCH', body: { skillName: 'go-deep' } } },
      { path: '/workspaces/repo%2Fa/preferences/skill-usage' },
      { path: '/workspaces/repo%2Fa/preferences/commit-skill-usage' },
      { path: '/workspaces/repo%2Fa/tasks/settings' },
      {
        path: '/workspaces/repo%2Fa/tasks/settings',
        options: { method: 'PATCH', body: { folderPaths: ['tasks', 'plans'] } },
      },
      { path: '/workspaces/repo%2Fa/llm-tools-config' },
      {
        path: '/workspaces/repo%2Fa/llm-tools-config',
        options: { method: 'PUT', body: { disabledLlmTools: [] } },
      },
      {
        path: '/workspaces/repo%2Fa/endev/status',
        options: { query: { refresh: 'true' } },
      },
      {
        path: '/workspaces/repo%2Fa/endev/revalidate',
        options: { method: 'POST' },
      },
    ]);
  });

  it('copies array payloads for task settings and LLM tools updates', async () => {
    const adapter = createMockAdapter({});
    const client = new PreferencesClient(adapter);
    const folderPaths = ['tasks'];
    const disabledLlmTools = ['create_update_work_item'];

    await client.updateTaskSettings('repo-a', { folderPaths });
    await client.updateLlmToolsConfig('repo-a', { disabledLlmTools });
    folderPaths.push('mutated');
    disabledLlmTools.push('mutated');

    expect(adapter.calls).toMatchObject([
      {
        path: '/workspaces/repo-a/tasks/settings',
        options: { method: 'PATCH', body: { folderPaths: ['tasks'] } },
      },
      {
        path: '/workspaces/repo-a/llm-tools-config',
        options: { method: 'PUT', body: { disabledLlmTools: ['create_update_work_item'] } },
      },
    ]);
  });
});
