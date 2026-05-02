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

    expect(adapter.calls).toMatchObject([
      { path: '/preferences' },
      { path: '/preferences', options: { method: 'PATCH', body: { theme: 'dark' } } },
      { path: '/workspaces/repo%2Fa/preferences' },
      { path: '/workspaces/repo%2Fa/preferences', options: { method: 'PATCH', body: { lastDepth: 'deep' } } },
      { path: '/workspaces/repo%2Fa/preferences/skill-usage', options: { method: 'PATCH', body: { skillName: 'impl' } } },
    ]);
  });
});
