import { describe, expect, it } from 'vitest';
import { SkillsClient } from '../../src';
import { createMockAdapter } from './helpers';

const EMPTY_RESPONSE = {
  skills: [],
  skill: { name: 'impl' },
  success: true,
  installed: 0,
  skipped: 0,
  failed: 0,
  details: [],
  globalDisabledSkills: [],
  globalSkillsDir: '',
  global: [],
  repo: [],
  merged: [],
  path: '',
  skillCount: 0,
  accessible: true,
  usage: [],
};

describe('SkillsClient', () => {
  it('calls global skill management routes', async () => {
    const adapter = createMockAdapter(EMPTY_RESPONSE);
    const client = new SkillsClient(adapter);

    await client.listGlobal();
    await client.listBundledGlobal();
    await client.detailGlobal('skill/name');
    await client.scanGlobal({ url: 'https://github.com/owner/repo' });
    await client.installGlobal({ source: 'bundled', skills: ['impl'], replace: true });
    await client.getGlobalConfig();
    await client.updateGlobalConfig({ globalDisabledSkills: ['legacy'] });
    await client.deleteGlobal('skill/name');

    expect(adapter.calls).toMatchObject([
      { path: '/skills' },
      { path: '/skills/bundled' },
      { path: '/skills/skill%2Fname' },
      { path: '/skills/scan', options: { method: 'POST', body: { url: 'https://github.com/owner/repo' } } },
      { path: '/skills/install', options: { method: 'POST', body: { source: 'bundled', skills: ['impl'], replace: true } } },
      { path: '/skills/config' },
      { path: '/skills/config', options: { method: 'PUT', body: { globalDisabledSkills: ['legacy'] } } },
      { path: '/skills/skill%2Fname', options: { method: 'DELETE' } },
    ]);
  });

  it('calls workspace skill and usage routes with once-encoded IDs', async () => {
    const adapter = createMockAdapter(EMPTY_RESPONSE);
    const client = new SkillsClient(adapter);
    const workspaceId = 'repo/a space';

    await client.listWorkspace(workspaceId);
    await client.listBundledWorkspace(workspaceId);
    await client.listAllWorkspace(workspaceId);
    await client.scanWorkspace(workspaceId, { url: 'C:\\repo\\skills' });
    await client.getWorkspacePath(workspaceId);
    await client.installWorkspace(workspaceId, { url: 'C:\\repo\\skills', replace: true });
    await client.detailWorkspace(workspaceId, 'impl/skill');
    await client.deleteWorkspace(workspaceId, 'impl/skill');
    await client.recordUsage(workspaceId, 'impl');
    await client.getUsage(workspaceId, { skillName: 'impl', since: '2026-05-02T00:00:00.000Z' });

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa%20space/skills' },
      { path: '/workspaces/repo%2Fa%20space/skills/bundled' },
      { path: '/workspaces/repo%2Fa%20space/skills/all' },
      { path: '/workspaces/repo%2Fa%20space/skills/scan', options: { method: 'POST', body: { url: 'C:\\repo\\skills' } } },
      { path: '/workspaces/repo%2Fa%20space/skills-path' },
      { path: '/workspaces/repo%2Fa%20space/skills/install', options: { method: 'POST', body: { url: 'C:\\repo\\skills', replace: true } } },
      { path: '/workspaces/repo%2Fa%20space/skills/impl%2Fskill' },
      { path: '/workspaces/repo%2Fa%20space/skills/impl%2Fskill', options: { method: 'DELETE' } },
      { path: '/workspaces/repo%2Fa%20space/preferences/skill-usage', options: { method: 'PATCH', body: { skillName: 'impl' } } },
      {
        path: '/workspaces/repo%2Fa%20space/preferences/skill-usage',
        options: { query: { skillName: 'impl', since: '2026-05-02T00:00:00.000Z' } },
      },
    ]);
  });

  it('normalizes missing list payloads to empty arrays', async () => {
    const adapter = createMockAdapter({});
    const client = new SkillsClient(adapter);

    await expect(client.listGlobal()).resolves.toEqual([]);
    await expect(client.listBundledGlobal()).resolves.toEqual([]);
    await expect(client.listWorkspace('repo')).resolves.toEqual([]);
    await expect(client.listBundledWorkspace('repo')).resolves.toEqual([]);
  });
});
