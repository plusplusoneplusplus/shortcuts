import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, PreferencesClient } from '../../src';
import {
  startMockServer,
  type MockServer,
  type RecordedRequest,
} from '../mock-server';
import { createMockAdapter } from './helpers';

describe('PreferencesClient mock coverage', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('reads and updates global preferences without local default merging', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/preferences', { body: { theme: 'dark' } });
    mock.on('PATCH', '/api/preferences', {
      body: {
        theme: 'dark',
        reposSidebarCollapsed: false,
        htmlEmbed: { enabled: true },
      },
    });
    const client = createClient(mock);

    await expect(client.preferences.getGlobal()).resolves.toEqual({ theme: 'dark' });
    await expect(client.preferences.updateGlobal({
      reposSidebarCollapsed: false,
      htmlEmbed: { enabled: true },
    })).resolves.toEqual({
      theme: 'dark',
      reposSidebarCollapsed: false,
      htmlEmbed: { enabled: true },
    });

    expectGetRequest(mock.requests[0], '/api/preferences');
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/preferences', {
      reposSidebarCollapsed: false,
      htmlEmbed: { enabled: true },
    });
  });

  it('replaces global and per-repo preferences with JSON request bodies', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/preferences', { body: { theme: 'auto', hasSeenWelcome: true } });
    mock.on('PUT', '/api/workspaces/repo%2Fa/preferences', {
      body: {
        lastModel: 'gpt-5.5',
        lastChatProvider: 'auto',
        disabledLlmTools: ['tavily_web_search'],
      },
    });
    const client = createClient(mock);

    await expect(client.preferences.replaceGlobal({ theme: 'auto', hasSeenWelcome: true })).resolves.toEqual({
      theme: 'auto',
      hasSeenWelcome: true,
    });
    await expect(client.preferences.replaceRepo('repo/a', {
      lastModel: 'gpt-5.5',
      lastChatProvider: 'auto',
      disabledLlmTools: ['tavily_web_search'],
    })).resolves.toEqual({
      lastModel: 'gpt-5.5',
      lastChatProvider: 'auto',
      disabledLlmTools: ['tavily_web_search'],
    });

    expectJsonRequest(mock.requests[0], 'PUT', '/api/preferences', {
      theme: 'auto',
      hasSeenWelcome: true,
    });
    expectJsonRequest(mock.requests[1], 'PUT', '/api/workspaces/repo%2Fa/preferences', {
      lastModel: 'gpt-5.5',
      lastChatProvider: 'auto',
      disabledLlmTools: ['tavily_web_search'],
    });
  });

  it('reads and updates per-repo preferences with once-encoded workspace IDs', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/repo%2Fa/preferences', {
      body: {
        lastDepth: 'deep',
        boundedMemory: { enabled: false },
      },
    });
    mock.on('PATCH', '/api/workspaces/repo%2Fa/preferences', {
      body: {
        lastDepth: 'deep',
        lastSkills: { task: ['impl'] },
      },
    });
    const client = createClient(mock);

    await expect(client.preferences.getRepo('repo/a')).resolves.toEqual({
      lastDepth: 'deep',
      boundedMemory: { enabled: false },
    });
    await expect(client.preferences.updateRepo('repo/a', {
      lastSkills: { task: ['impl'] },
    })).resolves.toEqual({
      lastDepth: 'deep',
      lastSkills: { task: ['impl'] },
    });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fa/preferences');
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/repo%2Fa/preferences', {
      lastSkills: { task: ['impl'] },
    });
  });

  it('keeps patchGlobal and patchRepo aliases on PATCH endpoints', async () => {
    const adapter = createMockAdapter({});
    const client = new PreferencesClient(adapter);

    await client.patchGlobal({ theme: 'light' });
    await client.patchRepo('repo/a', { lastDepth: 'normal' });

    expect(adapter.calls).toEqual([
      {
        path: '/preferences',
        options: { method: 'PATCH', body: { theme: 'light' } },
      },
      {
        path: '/workspaces/repo%2Fa/preferences',
        options: { method: 'PATCH', body: { lastDepth: 'normal' } },
      },
    ]);
  });

  it('records skill usage twice and reads filtered usage without client-side de-duping', async () => {
    mock = await startMockServer();
    const first = { skillName: 'impl', timestamp: '2026-05-02T09:00:00.000Z' };
    const second = { skillName: 'impl', timestamp: '2026-05-02T09:05:00.000Z' };
    mock.on('PATCH', '/api/workspaces/repo%2Fa/preferences/skill-usage', [
      { body: first },
      { body: second },
    ]);
    mock.on('GET', '/api/workspaces/repo%2Fa/preferences/skill-usage', {
      body: { usage: [second] },
    });
    const client = createClient(mock);

    await expect(client.preferences.recordSkillUsage('repo/a', 'impl')).resolves.toEqual(first);
    await expect(client.preferences.recordSkillUsage('repo/a', 'impl')).resolves.toEqual(second);
    await expect(client.preferences.getSkillUsage('repo/a', {
      skillName: 'impl',
      since: '2026-05-02T09:01:00.000Z',
    })).resolves.toEqual({ usage: [second] });

    expectJsonRequest(mock.requests[0], 'PATCH', '/api/workspaces/repo%2Fa/preferences/skill-usage', {
      skillName: 'impl',
    });
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/repo%2Fa/preferences/skill-usage', {
      skillName: 'impl',
    });
    expectGetRequest(mock.requests[2], '/api/workspaces/repo%2Fa/preferences/skill-usage', {
      skillName: 'impl',
      since: '2026-05-02T09:01:00.000Z',
    });
  });

  it('reads and updates task settings through typed preference methods', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/repo%2Fa/tasks/settings', {
      body: {
        taskRootPath: 'C:\\repo\\.coc\\tasks',
        folderPaths: ['tasks'],
        hasDefaultFolderPaths: true,
      },
    });
    mock.on('PATCH', '/api/workspaces/repo%2Fa/tasks/settings', {
      body: { folderPaths: ['tasks', 'plans'] },
    });
    const client = createClient(mock);

    await expect(client.preferences.getTaskSettings('repo/a')).resolves.toEqual({
      taskRootPath: 'C:\\repo\\.coc\\tasks',
      folderPaths: ['tasks'],
      hasDefaultFolderPaths: true,
    });
    await expect(client.preferences.updateTaskSettings('repo/a', {
      folderPaths: ['tasks', 'plans'],
    })).resolves.toEqual({ folderPaths: ['tasks', 'plans'] });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fa/tasks/settings');
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/repo%2Fa/tasks/settings', {
      folderPaths: ['tasks', 'plans'],
    });
  });

  it('preserves explicit empty LLM tool override arrays', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/repo%2Fa/llm-tools-config', {
      body: {
        tools: [{ name: 'create_update_work_item', label: 'Create/Update Work Item', description: 'Creates bugs and work items.', enabledByDefault: true }],
        disabledLlmTools: ['create_update_work_item'],
      },
    });
    mock.on('PUT', '/api/workspaces/repo%2Fa/llm-tools-config', {
      body: {
        tools: [{ name: 'create_update_work_item', label: 'Create/Update Work Item', description: 'Creates bugs and work items.', enabledByDefault: true }],
        disabledLlmTools: [],
      },
    });
    const client = createClient(mock);

    await expect(client.preferences.getLlmToolsConfig('repo/a')).resolves.toEqual({
      tools: [{ name: 'create_update_work_item', label: 'Create/Update Work Item', description: 'Creates bugs and work items.', enabledByDefault: true }],
      disabledLlmTools: ['create_update_work_item'],
    });
    await expect(client.preferences.updateLlmToolsConfig('repo/a', {
      disabledLlmTools: [],
    })).resolves.toEqual({
      tools: [{ name: 'create_update_work_item', label: 'Create/Update Work Item', description: 'Creates bugs and work items.', enabledByDefault: true }],
      disabledLlmTools: [],
    });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fa/llm-tools-config');
    expectJsonRequest(mock.requests[1], 'PUT', '/api/workspaces/repo%2Fa/llm-tools-config', {
      disabledLlmTools: [],
    });
  });

  it('propagates preference and skill usage errors as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/missing%2Frepo/preferences', {
      status: 404,
      body: {
        error: {
          message: 'Workspace not found',
          code: 'WORKSPACE_NOT_FOUND',
          details: { workspaceId: 'missing/repo' },
        },
      },
    });
    mock.on('PATCH', '/api/preferences', {
      status: 400,
      body: {
        error: {
          message: 'Invalid preferences patch',
          code: 'VALIDATION_FAILED',
          details: { fieldErrors: { theme: 'Invalid theme' } },
        },
      },
    });
    mock.on('PATCH', '/api/workspaces/repo%2Fa/preferences/skill-usage', {
      status: 400,
      body: {
        error: {
          message: '`skillName` is required',
          code: 'BAD_REQUEST',
        },
      },
    });
    const client = createClient(mock);

    await expect(client.preferences.getRepo('missing/repo')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Workspace not found',
      code: 'WORKSPACE_NOT_FOUND',
      details: { workspaceId: 'missing/repo' },
    } satisfies Partial<CocApiError>);
    await expect(client.preferences.updateGlobal({ theme: 'dark' })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 400,
      message: 'Invalid preferences patch',
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { theme: 'Invalid theme' } },
    } satisfies Partial<CocApiError>);
    await expect(client.preferences.recordSkillUsage('repo/a', '')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 400,
      message: '`skillName` is required',
      code: 'BAD_REQUEST',
    } satisfies Partial<CocApiError>);
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string, query: Record<string, string> = {}): void {
  expectEmptyRequest(request, 'GET', path, query);
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
