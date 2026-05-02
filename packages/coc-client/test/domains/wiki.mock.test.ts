import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, type CreateWikiRequest, type UpdateWikiRequest, type WikiComponentGraph } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('WikiClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('lists wikis and normalizes wrapped responses', async () => {
    mock = await startMockServer();
    const wikis = [{ id: 'repo/wiki one', name: 'Wiki One', loaded: true, componentCount: 2 }];
    mock.on('GET', '/api/wikis', [
      { body: wikis },
      { body: { wikis } },
    ]);
    const client = createClient(mock);

    await expect(client.wiki.list()).resolves.toEqual(wikis);
    await expect(client.wiki.list()).resolves.toEqual(wikis);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/wikis');
    expectEmptyRequest(mock.requests[1], 'GET', '/api/wikis');
  });

  it('creates, reads, updates, and deletes wiki registrations with encoded IDs', async () => {
    mock = await startMockServer();
    const created = {
      success: true,
      id: 'repo/wiki one',
      wikiDir: 'C:\\coc\\wikis\\repo-wiki-one',
      repoPath: 'C:\\repos\\repo one',
      hasExistingData: false,
      generateWithAI: false,
      name: 'Wiki One',
      color: '#3b82f6',
    };
    const createRequest: CreateWikiRequest = {
      id: 'repo/wiki one',
      name: 'Wiki One',
      repoPath: 'C:\\repos\\repo one',
      color: '#3b82f6',
    };
    const updateRequest: UpdateWikiRequest = { name: 'Renamed Wiki', color: '#22c55e' };
    mock.on('POST', '/api/wikis', { status: 201, body: created });
    mock.on('GET', '/api/wikis/repo%2Fwiki%20one', { body: { id: 'repo/wiki one', title: 'Wiki One', loaded: false } });
    mock.on('PATCH', '/api/wikis/repo%2Fwiki%20one', { body: { success: true, id: 'repo/wiki one' } });
    mock.on('DELETE', '/api/wikis/repo%2Fwiki%20one', { body: { success: true, id: 'repo/wiki one' } });
    const client = createClient(mock);

    await expect(client.wiki.create(createRequest)).resolves.toEqual(created);
    await expect(client.wiki.get('repo/wiki one')).resolves.toMatchObject({ title: 'Wiki One' });
    await expect(client.wiki.update('repo/wiki one', updateRequest)).resolves.toEqual({ success: true, id: 'repo/wiki one' });
    await expect(client.wiki.delete('repo/wiki one')).resolves.toEqual({ success: true, id: 'repo/wiki one' });

    expectJsonRequest(mock.requests[0], 'POST', '/api/wikis', createRequest);
    expectEmptyRequest(mock.requests[1], 'GET', '/api/wikis/repo%2Fwiki%20one');
    expectJsonRequest(mock.requests[2], 'PATCH', '/api/wikis/repo%2Fwiki%20one', updateRequest);
    expectEmptyRequest(mock.requests[3], 'DELETE', '/api/wikis/repo%2Fwiki%20one');
  });

  it('reads graph, component, page, theme, and admin resources', async () => {
    mock = await startMockServer();
    const graph: WikiComponentGraph = {
      project: { name: 'Wiki One', description: 'Docs', mainLanguage: 'TypeScript' },
      components: [{ id: 'auth/core', name: 'Auth', path: 'src\\auth.ts', purpose: 'Auth', category: 'api' }],
      categories: [{ id: 'api', name: 'API' }],
    };
    mock.on('GET', '/api/wikis/wiki%201/graph', { body: graph });
    mock.on('GET', '/api/wikis/wiki%201/components', { body: [{ id: 'auth/core', name: 'Auth', category: 'api', path: 'src\\auth.ts', purpose: 'Auth' }] });
    mock.on('GET', '/api/wikis/wiki%201/components/auth%2Fcore', { body: { component: graph.components[0], markdown: '# Auth' } });
    mock.on('GET', '/api/wikis/wiki%201/pages/getting-started', { body: { key: 'getting-started', title: 'Getting Started', markdown: '# Start' } });
    mock.on('GET', '/api/wikis/wiki%201/themes', { body: [{ id: 'security', title: 'Security', description: 'Auth', layout: 'single', articles: [] }] });
    mock.on('GET', '/api/wikis/wiki%201/themes/security', { body: { id: 'security', title: 'Security', description: 'Auth', layout: 'single', articles: [] } });
    mock.on('GET', '/api/wikis/wiki%201/themes/security/overview', { body: { themeId: 'security', slug: 'overview', content: '# Security', meta: { id: 'security', title: 'Security', description: 'Auth', layout: 'single', articles: [] } } });
    mock.on('GET', '/api/wikis/wiki%201/admin/config', { body: { exists: true, content: 'model: gpt-test\n', path: 'C:\\repos\\repo\\deep-wiki.config.yaml' } });
    mock.on('PUT', '/api/wikis/wiki%201/admin/config', { body: { success: true, path: 'C:\\repos\\repo\\deep-wiki.config.yaml' } });
    mock.on('GET', '/api/wikis/wiki%201/admin/generate/status', { body: { phases: { 1: { cached: true } }, metadata: { components: 1 } } });
    mock.on('POST', '/api/wikis/wiki%201/admin/generate/cancel', { body: { cancelled: true } });
    const client = createClient(mock);

    await expect(client.wiki.graph('wiki 1')).resolves.toEqual(graph);
    await expect(client.wiki.components('wiki 1')).resolves.toHaveLength(1);
    await expect(client.wiki.component('wiki 1', 'auth/core')).resolves.toMatchObject({ markdown: '# Auth' });
    await expect(client.wiki.page('wiki 1', 'getting-started')).resolves.toMatchObject({ title: 'Getting Started' });
    await expect(client.wiki.themes('wiki 1')).resolves.toHaveLength(1);
    await expect(client.wiki.theme('wiki 1', 'security')).resolves.toMatchObject({ title: 'Security' });
    await expect(client.wiki.themeArticle('wiki 1', 'security', 'overview')).resolves.toMatchObject({ content: '# Security' });
    await expect(client.wiki.getAdminResource('wiki 1', 'config')).resolves.toMatchObject({ content: 'model: gpt-test\n' });
    await expect(client.wiki.updateAdminResource('wiki 1', 'config', 'model: gpt-new\n')).resolves.toMatchObject({ success: true });
    await expect(client.wiki.generateStatus('wiki 1')).resolves.toMatchObject({ metadata: { components: 1 } });
    await expect(client.wiki.cancelGenerate('wiki 1')).resolves.toMatchObject({ cancelled: true });

    expectEmptyRequest(mock.requests[2], 'GET', '/api/wikis/wiki%201/components/auth%2Fcore');
    expectJsonRequest(mock.requests[8], 'PUT', '/api/wikis/wiki%201/admin/config', { content: 'model: gpt-new\n' });
    expectEmptyRequest(mock.requests[10], 'POST', '/api/wikis/wiki%201/admin/generate/cancel');
  });

  it('streams ask, explore, generation, and standalone admin requests with typed JSON bodies', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/wikis/wiki%2Fone/ask', { rawBody: 'data: {"type":"done"}\n\n', headers: { 'content-type': 'text/event-stream' } });
    mock.on('DELETE', '/api/wikis/wiki%2Fone/ask/session/session%2F1', { body: { destroyed: true, sessionId: 'session/1' } });
    mock.on('POST', '/api/wikis/wiki%2Fone/explore/auth%2Fcore', { rawBody: 'data: {"type":"done"}\n\n', headers: { 'content-type': 'text/event-stream' } });
    mock.on('POST', '/api/wikis/wiki%2Fone/admin/generate', { rawBody: 'data: {"type":"done"}\n\n', headers: { 'content-type': 'text/event-stream' } });
    mock.on('POST', '/api/wikis/wiki%2Fone/admin/seeds/generate', { rawBody: 'data: {"type":"done"}\n\n', headers: { 'content-type': 'text/event-stream' } });
    mock.on('POST', '/api/admin/generate/component/auth%2Fcore', { rawBody: 'data: {"type":"done"}\n\n', headers: { 'content-type': 'text/event-stream' } });
    const client = createClient(mock);

    await expect(client.wiki.askStream('wiki/one', { question: 'What is auth?', componentId: 'auth/core' }).then(response => response.text())).resolves.toContain('done');
    await expect(client.wiki.deleteAskSession('wiki/one', 'session/1')).resolves.toEqual({ destroyed: true, sessionId: 'session/1' });
    await expect(client.wiki.exploreStream('wiki/one', 'auth/core', { depth: 'deep' }).then(response => response.text())).resolves.toContain('done');
    await expect(client.wiki.startGenerateStream('wiki/one', { startPhase: 2, endPhase: 4, force: true }).then(response => response.text())).resolves.toContain('done');
    await expect(client.wiki.generateSeedsStream('wiki/one').then(response => response.text())).resolves.toContain('done');
    await expect(client.wiki.regenerateStandaloneComponentStream('auth/core', { force: true }).then(response => response.text())).resolves.toContain('done');

    expectJsonRequest(mock.requests[0], 'POST', '/api/wikis/wiki%2Fone/ask', { question: 'What is auth?', componentId: 'auth/core' });
    expectEmptyRequest(mock.requests[1], 'DELETE', '/api/wikis/wiki%2Fone/ask/session/session%2F1');
    expectJsonRequest(mock.requests[2], 'POST', '/api/wikis/wiki%2Fone/explore/auth%2Fcore', { depth: 'deep' });
    expectJsonRequest(mock.requests[3], 'POST', '/api/wikis/wiki%2Fone/admin/generate', { startPhase: 2, endPhase: 4, force: true });
    expectJsonRequest(mock.requests[4], 'POST', '/api/wikis/wiki%2Fone/admin/seeds/generate', {});
    expectJsonRequest(mock.requests[5], 'POST', '/api/admin/generate/component/auth%2Fcore', { force: true });
  });

  it('propagates wiki API errors as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/wikis/missing', {
      status: 404,
      body: { error: 'Wiki not found: missing' },
    });
    const client = createClient(mock);

    await expect(client.wiki.get('missing')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Wiki not found: missing',
    } satisfies Partial<CocApiError>);
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
