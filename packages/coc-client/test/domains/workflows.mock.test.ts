import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, type CreateWorkflowRequest, type GenerateWorkflowRequest, type RefineWorkflowRequest, type RunWorkflowRequest } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('WorkflowClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('reads workflow definitions, content, and run history with encoded path and query values', async () => {
    mock = await startMockServer();
    const summaryResponse = {
      workflows: [
        {
          name: 'Bug Triage',
          path: '/repo/.vscode/workflows/Bug Triage',
          description: 'Review bugs',
          isValid: true,
          validationErrors: [],
        },
      ],
      tasks: { name: 'root' },
    };
    const contentResponse = { content: 'name: Bug Triage\n', path: '/repo/.vscode/workflows/Bug Triage/pipeline.yaml' };
    const historyResponse = {
      history: [
        { id: 'task-1', type: 'run-workflow', status: 'completed', priority: 'normal', createdAt: 1770000000000, payload: {}, config: {} },
      ],
    };
    mock.on('GET', '/api/workspaces/repo%2Fwith%2Fslashes/summary', { body: summaryResponse });
    mock.on('GET', '/api/workspaces/repo%2Fwith%2Fslashes/workflows/Bug%20Triage/content', { body: contentResponse });
    mock.on('GET', '/api/queue/history', { body: historyResponse });
    const client = createClient(mock);

    await expect(client.workflow.summary('repo/with/slashes', { folder: '.github/workflows', showArchived: true })).resolves.toEqual(summaryResponse);
    await expect(client.workflow.list('repo/with/slashes')).resolves.toEqual(summaryResponse.workflows);
    await expect(client.workflow.content('repo/with/slashes', 'Bug Triage', { folder: '.github/workflows' })).resolves.toEqual(contentResponse);
    await expect(client.workflow.runHistory('repo/with/slashes', 'Bug Triage', { limit: 50 })).resolves.toEqual(historyResponse);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/workspaces/repo%2Fwith%2Fslashes/summary', {
      folder: '.github/workflows',
      showArchived: 'true',
    });
    expectEmptyRequest(mock.requests[1], 'GET', '/api/workspaces/repo%2Fwith%2Fslashes/summary');
    expectEmptyRequest(mock.requests[2], 'GET', '/api/workspaces/repo%2Fwith%2Fslashes/workflows/Bug%20Triage/content', {
      folder: '.github/workflows',
    });
    expectEmptyRequest(mock.requests[3], 'GET', '/api/queue/history', {
      repoId: 'repo/with/slashes',
      pipelineName: 'Bug Triage',
      limit: '50',
    });
  });

  it('pins workflow mutation methods, paths, query values, and JSON bodies', async () => {
    mock = await startMockServer();
    mock.on('PATCH', '/api/workspaces/ws-1/workflows/Bug%20Triage/content', { body: { path: '/repo/workflow/pipeline.yaml' } });
    mock.on('POST', '/api/workspaces/ws-1/workflows', { status: 201, body: { name: 'Bug Triage', path: '/repo/workflow', template: 'custom' } });
    mock.on('POST', '/api/workspaces/ws-1/workflows/generate', { body: { yaml: 'name: generated\n', valid: true, suggestedName: 'generated' } });
    mock.on('POST', '/api/workspaces/ws-1/workflows/refine', { body: { yaml: 'name: refined\n', valid: true } });
    mock.on('POST', '/api/workspaces/ws-1/workflows/Bug%20Triage/run', { status: 201, body: { taskId: 'task-1', pipelineName: 'Bug Triage', queuedAt: 1770000001000 } });
    mock.on('DELETE', '/api/workspaces/ws-1/workflows/Bug%20Triage', { body: { deleted: 'Bug Triage' } });
    const client = createClient(mock);
    const createRequest: CreateWorkflowRequest = {
      name: 'Bug Triage',
      template: 'custom',
      content: 'name: Bug Triage\n',
    };
    const generateRequest: GenerateWorkflowRequest = {
      name: 'Bug Triage',
      description: 'Create a workflow for bug triage',
      model: 'gpt-5.4',
    };
    const refineRequest: RefineWorkflowRequest = {
      instruction: 'Add a reduce step',
      currentYaml: 'name: Bug Triage\n',
      model: 'gpt-5.4',
    };
    const runRequest: RunWorkflowRequest = {
      model: 'gpt-5.4',
      params: { severity: 'high' },
      priority: 'high',
    };

    await expect(client.workflow.saveContent('ws-1', 'Bug Triage', 'name: Bug Triage\n', { folder: '.github/workflows' })).resolves.toEqual({ path: '/repo/workflow/pipeline.yaml' });
    await expect(client.workflow.create('ws-1', createRequest, { folder: '.github/workflows' })).resolves.toEqual({ name: 'Bug Triage', path: '/repo/workflow', template: 'custom' });
    await expect(client.workflow.generate('ws-1', generateRequest)).resolves.toMatchObject({ valid: true, suggestedName: 'generated' });
    await expect(client.workflow.refine('ws-1', refineRequest)).resolves.toMatchObject({ valid: true, yaml: 'name: refined\n' });
    await expect(client.workflow.run('ws-1', 'Bug Triage', runRequest, { folder: '.github/workflows' })).resolves.toMatchObject({ taskId: 'task-1' });
    await expect(client.workflow.delete('ws-1', 'Bug Triage', { folder: '.github/workflows' })).resolves.toEqual({ deleted: 'Bug Triage' });

    expectJsonRequest(mock.requests[0], 'PATCH', '/api/workspaces/ws-1/workflows/Bug%20Triage/content', { content: 'name: Bug Triage\n' }, {
      folder: '.github/workflows',
    });
    expectJsonRequest(mock.requests[1], 'POST', '/api/workspaces/ws-1/workflows', createRequest, {
      folder: '.github/workflows',
    });
    expectJsonRequest(mock.requests[2], 'POST', '/api/workspaces/ws-1/workflows/generate', generateRequest);
    expectJsonRequest(mock.requests[3], 'POST', '/api/workspaces/ws-1/workflows/refine', refineRequest);
    expectJsonRequest(mock.requests[4], 'POST', '/api/workspaces/ws-1/workflows/Bug%20Triage/run', runRequest, {
      folder: '.github/workflows',
    });
    expectEmptyRequest(mock.requests[5], 'DELETE', '/api/workspaces/ws-1/workflows/Bug%20Triage', {
      folder: '.github/workflows',
    });
  });

  it('omits undefined optional body fields and propagates workflow API errors', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/workspaces/ws-1/workflows', { status: 201, body: { name: 'empty', path: '/repo/empty', template: 'custom' } });
    mock.on('POST', '/api/workspaces/ws-1/workflows/invalid/run', {
      status: 404,
      body: {
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
          details: { pipelineName: 'invalid' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.workflow.create('ws-1', { name: 'empty', template: undefined, content: undefined })).resolves.toMatchObject({ name: 'empty' });
    await expect(client.workflow.run('ws-1', 'invalid')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Workflow not found',
      code: 'WORKFLOW_NOT_FOUND',
      details: { pipelineName: 'invalid' },
    } satisfies Partial<CocApiError>);

    expectJsonRequest(mock.requests[0], 'POST', '/api/workspaces/ws-1/workflows', { name: 'empty' });
    expectJsonRequest(mock.requests[1], 'POST', '/api/workspaces/ws-1/workflows/invalid/run', {});
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
