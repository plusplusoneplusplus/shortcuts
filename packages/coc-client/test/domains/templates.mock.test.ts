import { afterEach, describe, expect, it } from 'vitest';
import {
  CocApiError,
  CocClient,
  type CreateTemplateRequest,
  type ReplicateTemplateRequest,
  type Template,
  type TemplateDetail,
  type UpdateTemplateRequest,
} from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('TemplatesClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('lists templates and reads details with once-encoded workspace and template names', async () => {
    mock = await startMockServer();
    const template: Template = {
      name: 'Fix Parser',
      kind: 'commit',
      commitHash: 'abc123',
      description: 'Template with spaces',
      hints: ['keep tests'],
      createdAt: '2026-05-02T00:00:00.000Z',
      _fileName: 'Fix Parser',
    };
    const detail: TemplateDetail = {
      ...template,
      changedFiles: [{ path: 'src/parser.ts', status: 'modified', additions: 4, deletions: 1 }],
      _commit: {
        shortHash: 'abc123',
        subject: 'Fix parser',
        authorName: 'Example Author',
        date: '2026-05-02T00:00:00.000Z',
        relativeDate: 'today',
      },
    };
    mock.on('GET', '/api/workspaces/repo%2Fwith%20space/templates', { body: { templates: [template] } });
    mock.on('GET', '/api/workspaces/repo%2Fwith%20space/templates/Fix%20Parser', { body: detail });
    const client = createClient(mock);

    await expect(client.templates.list('repo/with space')).resolves.toEqual([template]);
    await expect(client.templates.detail('repo/with space', 'Fix Parser')).resolves.toEqual(detail);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/workspaces/repo%2Fwith%20space/templates');
    expectEmptyRequest(mock.requests[1], 'GET', '/api/workspaces/repo%2Fwith%20space/templates/Fix%20Parser');
  });

  it('pins create, update, delete, and replicate paths and JSON bodies', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/workspaces/ws-1/templates', { status: 201, body: { name: 'fix-parser', path: '/repo/.vscode/templates/fix-parser.yaml' } });
    mock.on('PATCH', '/api/workspaces/ws-1/templates/fix-parser', { body: { name: 'fix-parser', path: '/repo/.vscode/templates/fix-parser.yaml' } });
    mock.on('DELETE', '/api/workspaces/ws-1/templates/fix-parser', { body: { deleted: 'fix-parser' } });
    mock.on('POST', '/api/workspaces/ws-1/templates/fix-parser/replicate', { status: 202, body: { taskId: 'task-1' } });
    const client = createClient(mock);
    const createRequest: CreateTemplateRequest = {
      name: 'fix-parser',
      kind: 'commit',
      commitHash: 'abc123',
      description: 'Fix parser template',
      hints: ['preserve public API'],
    };
    const updateRequest: UpdateTemplateRequest = {
      description: 'Updated description',
      hints: ['add regression test'],
    };
    const replicateRequest: ReplicateTemplateRequest = {
      instruction: 'Apply this pattern to config parsing',
      model: 'gpt-5.5',
    };

    await expect(client.templates.create('ws-1', createRequest)).resolves.toMatchObject({ name: 'fix-parser' });
    await expect(client.templates.update('ws-1', 'fix-parser', updateRequest)).resolves.toMatchObject({ name: 'fix-parser' });
    await expect(client.templates.delete('ws-1', 'fix-parser')).resolves.toEqual({ deleted: 'fix-parser' });
    await expect(client.templates.replicate('ws-1', 'fix-parser', replicateRequest)).resolves.toEqual({ taskId: 'task-1' });

    expectJsonRequest(mock.requests[0], 'POST', '/api/workspaces/ws-1/templates', createRequest);
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/ws-1/templates/fix-parser', updateRequest);
    expectEmptyRequest(mock.requests[2], 'DELETE', '/api/workspaces/ws-1/templates/fix-parser');
    expectJsonRequest(mock.requests[3], 'POST', '/api/workspaces/ws-1/templates/fix-parser/replicate', replicateRequest);
  });

  it('returns an empty list for legacy empty response bodies and propagates API errors', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/ws-1/templates', { body: {} });
    mock.on('GET', '/api/workspaces/ws-1/templates/missing', {
      status: 404,
      body: {
        error: {
          message: 'Template not found',
          code: 'TEMPLATE_NOT_FOUND',
          details: { templateName: 'missing' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.templates.list('ws-1')).resolves.toEqual([]);
    await expect(client.templates.detail('ws-1', 'missing')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Template not found',
      code: 'TEMPLATE_NOT_FOUND',
      details: { templateName: 'missing' },
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
