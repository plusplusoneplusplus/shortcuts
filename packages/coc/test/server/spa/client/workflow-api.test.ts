import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchWorkflows,
    fetchWorkflowContent,
    saveWorkflowContent,
    generateWorkflow,
    refineWorkflow,
    createWorkflow,
    deleteWorkflow,
    runWorkflow,
} from '../../../../src/server/spa/client/react/features/workflow/workflow-api';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
}));

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
}

describe('workflow-api (cocClient migration)', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        resetSpaCocClientForTests();
        globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        vi.resetAllMocks();
    });

    describe('fetchWorkflows', () => {
        it('returns the workflows list from the summary endpoint', async () => {
            const workflows = [
                { name: 'a', path: 'p/a', isValid: true },
                { name: 'b', path: 'p/b', isValid: false, validationErrors: ['err'] },
            ];
            mockFetch.mockResolvedValueOnce(jsonResponse({ workflows }));

            const result = await fetchWorkflows('ws-1');

            expect(result).toEqual(workflows);
            expect(mockFetch).toHaveBeenCalledOnce();
            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toBe('/api/workspaces/ws-1/summary');
        });

        it('encodes workspace IDs with special characters', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ workflows: [] }));

            await fetchWorkflows('ws/special chars');

            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toBe('/api/workspaces/ws%2Fspecial%20chars/summary');
        });

        it('throws with server error message on 4xx', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse(
                { error: 'Workspace not found' },
                { status: 404, statusText: 'Not Found' },
            ));

            await expect(fetchWorkflows('bad-ws')).rejects.toThrow('Workspace not found');
        });
    });

    describe('fetchWorkflowContent', () => {
        it('returns content and path from the content endpoint', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ content: 'name: test', path: '/p/test/pipeline.yaml' }));

            const result = await fetchWorkflowContent('ws-1', 'test-wf');

            expect(result).toEqual({ content: 'name: test', path: '/p/test/pipeline.yaml' });
            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toBe('/api/workspaces/ws-1/workflows/test-wf/content');
        });

        it('encodes workflow names with special characters', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ content: '', path: '' }));

            await fetchWorkflowContent('ws-1', 'my workflow');

            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toBe('/api/workspaces/ws-1/workflows/my%20workflow/content');
        });
    });

    describe('saveWorkflowContent', () => {
        it('sends PATCH with content body', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ path: '/p' }));

            await saveWorkflowContent('ws-1', 'wf-1', 'name: updated');

            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-1/workflows/wf-1/content');
            expect(init.method).toBe('PATCH');
            expect(JSON.parse(init.body)).toEqual({ content: 'name: updated' });
        });

        it('throws with server message on failure', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse(
                { error: 'Validation failed' },
                { status: 400, statusText: 'Bad Request' },
            ));

            await expect(saveWorkflowContent('ws-1', 'wf-1', '')).rejects.toThrow('Validation failed');
        });
    });

    describe('generateWorkflow', () => {
        it('sends POST with description and optional name', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                yaml: 'name: gen', valid: true, suggestedName: 'gen',
            }));

            const result = await generateWorkflow('ws-1', 'my-wf', 'Generate a classifier');

            expect(result).toMatchObject({ yaml: 'name: gen', valid: true, suggestedName: 'gen' });
            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-1/workflows/generate');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ description: 'Generate a classifier', name: 'my-wf' });
        });

        it('omits name when undefined', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ yaml: '', valid: false }));

            await generateWorkflow('ws-1', undefined, 'Do something');

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body).toEqual({ description: 'Do something' });
            expect(body).not.toHaveProperty('name');
        });

        it('forwards AbortSignal', async () => {
            const controller = new AbortController();
            mockFetch.mockResolvedValueOnce(jsonResponse({ yaml: '', valid: true }));

            await generateWorkflow('ws-1', undefined, 'test', controller.signal);

            const passedSignal = mockFetch.mock.calls[0][1].signal;
            expect(passedSignal).toBeInstanceOf(AbortSignal);
            expect(passedSignal.aborted).toBe(false);
        });

        it('surfaces server error message on 4xx', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse(
                { error: 'Model unavailable' },
                { status: 503, statusText: 'Service Unavailable' },
            ));

            await expect(generateWorkflow('ws-1', undefined, 'test')).rejects.toThrow('Model unavailable');
        });
    });

    describe('refineWorkflow', () => {
        it('sends POST with instruction, currentYaml, and optional model', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                yaml: 'name: refined', valid: true,
            }));

            const result = await refineWorkflow('ws-1', 'wf-1', 'Add logging', 'name: old', 'gpt-4');

            expect(result).toMatchObject({ yaml: 'name: refined', valid: true });
            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-1/workflows/refine');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({
                instruction: 'Add logging',
                currentYaml: 'name: old',
                model: 'gpt-4',
            });
        });

        it('omits model when undefined', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ yaml: '', valid: true }));

            await refineWorkflow('ws-1', 'wf-1', 'Do X', 'yaml');

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body).not.toHaveProperty('model');
        });
    });

    describe('createWorkflow', () => {
        it('sends POST with name and optional template/content', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ name: 'new-wf', path: '/p', template: 'custom' }));

            await createWorkflow('ws-1', 'new-wf', 'custom');

            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-1/workflows');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ name: 'new-wf', template: 'custom' });
        });

        it('includes content when provided', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ name: 'wf', path: '/p', template: '' }));

            await createWorkflow('ws-1', 'wf', undefined, 'name: wf');

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body).toEqual({ name: 'wf', content: 'name: wf' });
        });
    });

    describe('deleteWorkflow', () => {
        it('sends DELETE to the workflow endpoint', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ deleted: 'wf-1' }));

            await deleteWorkflow('ws-1', 'wf-1');

            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-1/workflows/wf-1');
            expect(init.method).toBe('DELETE');
        });
    });

    describe('runWorkflow', () => {
        it('sends POST and returns RunWorkflowResponse with taskId', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                taskId: 'abc12345-6789', pipelineName: 'wf-1', queuedAt: 123,
            }));

            const result = await runWorkflow('ws-1', 'wf-1');

            expect(result.taskId).toBe('abc12345-6789');
            expect(result.pipelineName).toBe('wf-1');
            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-1/workflows/wf-1/run');
            expect(init.method).toBe('POST');
        });

        it('surfaces server error message on failure', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse(
                { error: 'Workflow not found' },
                { status: 404, statusText: 'Not Found' },
            ));

            await expect(runWorkflow('ws-1', 'missing')).rejects.toThrow('Workflow not found');
        });
    });
});
