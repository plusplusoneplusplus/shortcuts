import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, type DiscoveredSkill, type SkillInfo } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('SkillsClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('lists global skills, reads detail, updates config, and deletes with encoded skill names', async () => {
    mock = await startMockServer();
    const skill: SkillInfo = { name: 'impl', description: 'Implement changes', version: '1.0' };
    mock.on('GET', '/api/skills', { body: { skills: [skill] } });
    mock.on('GET', '/api/skills/impl%2Fcustom', { body: { skill } });
    mock.on('GET', '/api/skills/config', { body: { globalDisabledSkills: ['legacy'], globalSkillsDir: 'C:\\data\\skills' } });
    mock.on('PUT', '/api/skills/config', { body: { globalDisabledSkills: ['impl'], globalSkillsDir: 'C:\\data\\skills' } });
    mock.on('DELETE', '/api/skills/impl%2Fcustom', { status: 204 });
    const client = createClient(mock);

    await expect(client.skills.listGlobal()).resolves.toEqual([skill]);
    await expect(client.skills.detailGlobal('impl/custom')).resolves.toEqual({ skill });
    await expect(client.skills.getGlobalConfig()).resolves.toEqual({ globalDisabledSkills: ['legacy'], globalSkillsDir: 'C:\\data\\skills' });
    await expect(client.skills.updateGlobalConfig({ globalDisabledSkills: ['impl'] })).resolves.toEqual({ globalDisabledSkills: ['impl'], globalSkillsDir: 'C:\\data\\skills' });
    await expect(client.skills.deleteGlobal('impl/custom')).resolves.toBeUndefined();

    expectEmptyRequest(mock.requests[0], 'GET', '/api/skills');
    expectEmptyRequest(mock.requests[1], 'GET', '/api/skills/impl%2Fcustom');
    expectEmptyRequest(mock.requests[2], 'GET', '/api/skills/config');
    expectJsonRequest(mock.requests[3], 'PUT', '/api/skills/config', { globalDisabledSkills: ['impl'] });
    expectEmptyRequest(mock.requests[4], 'DELETE', '/api/skills/impl%2Fcustom');
  });

  it('scans and installs global skills with JSON bodies', async () => {
    mock = await startMockServer();
    const discovered: DiscoveredSkill = {
      name: 'impl',
      description: 'Implement changes',
      path: '.github/skills/impl',
      alreadyExists: false,
    };
    mock.on('GET', '/api/skills/bundled', { body: { skills: [discovered] } });
    mock.on('POST', '/api/skills/scan', { body: { success: true, skills: [discovered] } });
    mock.on('POST', '/api/skills/install', { body: { installed: 1, skipped: 0, failed: 0, details: [{ name: 'impl', success: true, action: 'installed' }] } });
    const client = createClient(mock);

    await expect(client.skills.listBundledGlobal()).resolves.toEqual([discovered]);
    await expect(client.skills.scanGlobal({ url: 'https://github.com/owner/repo' })).resolves.toEqual({ success: true, skills: [discovered] });
    await expect(client.skills.installGlobal({ url: 'https://github.com/owner/repo', skillsToInstall: [discovered], replace: true })).resolves.toMatchObject({ installed: 1 });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/skills/bundled');
    expectJsonRequest(mock.requests[1], 'POST', '/api/skills/scan', { url: 'https://github.com/owner/repo' });
    expectJsonRequest(mock.requests[2], 'POST', '/api/skills/install', { url: 'https://github.com/owner/repo', skillsToInstall: [discovered], replace: true });
  });

  it('uses workspace skill routes and propagates API errors', async () => {
    mock = await startMockServer();
    const skill: SkillInfo = { name: 'impl', source: 'repo' };
    mock.on('GET', '/api/workspaces/repo%2Fa/skills/all', { body: { global: [], repo: [skill], merged: [skill] } });
    mock.on('PATCH', '/api/workspaces/repo%2Fa/preferences/skill-usage', { body: { skillName: 'impl', timestamp: '2026-05-02T00:00:00.000Z' } });
    mock.on('GET', '/api/workspaces/repo%2Fa/preferences/skill-usage', { body: { usage: [{ skillName: 'impl', timestamp: '2026-05-02T00:00:00.000Z' }] } });
    mock.on('DELETE', '/api/workspaces/repo%2Fa/skills/missing', {
      status: 404,
      body: { error: { message: 'Skill not found', code: 'NOT_FOUND' } },
    });
    const client = createClient(mock);

    await expect(client.skills.listAllWorkspace('repo/a')).resolves.toEqual({ global: [], repo: [skill], merged: [skill] });
    await expect(client.skills.recordUsage('repo/a', 'impl')).resolves.toEqual({ skillName: 'impl', timestamp: '2026-05-02T00:00:00.000Z' });
    await expect(client.skills.getUsage('repo/a', { skillName: 'impl' })).resolves.toEqual({ usage: [{ skillName: 'impl', timestamp: '2026-05-02T00:00:00.000Z' }] });
    await expect(client.skills.deleteWorkspace('repo/a', 'missing')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Skill not found',
      code: 'NOT_FOUND',
    } satisfies Partial<CocApiError>);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/workspaces/repo%2Fa/skills/all');
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/repo%2Fa/preferences/skill-usage', { skillName: 'impl' });
    expectEmptyRequest(mock.requests[2], 'GET', '/api/workspaces/repo%2Fa/preferences/skill-usage', { skillName: 'impl' });
    expectEmptyRequest(mock.requests[3], 'DELETE', '/api/workspaces/repo%2Fa/skills/missing');
  });

  it('reads a workspace skill file with path query param', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/repo%2Fa/skills/impl/file', {
      body: { path: 'references/spec.md', content: '# spec', size: 6 },
    });
    const client = createClient(mock);

    await expect(
      client.skills.readWorkspaceSkillFile('repo/a', 'impl', 'references/spec.md'),
    ).resolves.toEqual({ path: 'references/spec.md', content: '# spec', size: 6 });

    expectEmptyRequest(
      mock.requests[0],
      'GET',
      '/api/workspaces/repo%2Fa/skills/impl/file',
      { path: 'references/spec.md' },
    );
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectEmptyRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectJsonRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
