/**
 * Tests for pipeline-api.ts typed API client and PipelineInfo type.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mock getApiBase() before importing the module under test
// ---------------------------------------------------------------------------
vi.mock(
    '../../../src/server/spa/client/react/utils/config',
    () => ({ getApiBase: () => 'http://localhost:4000/api' })
);

// We need to dynamically import after mock is set up
let fetchPipelines: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').fetchPipelines;
let fetchPipelineContent: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').fetchPipelineContent;
let savePipelineContent: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').savePipelineContent;
let createPipeline: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').createPipeline;
let deletePipeline: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').deletePipeline;
let generatePipeline: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').generatePipeline;
let refinePipeline: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').refinePipeline;
let runPipeline: typeof import('../../../src/server/spa/client/react/repos/pipeline-api').runPipeline;

beforeEach(async () => {
    const mod = await import('../../../src/server/spa/client/react/repos/pipeline-api');
    fetchPipelines = mod.fetchPipelines;
    fetchPipelineContent = mod.fetchPipelineContent;
    savePipelineContent = mod.savePipelineContent;
    createPipeline = mod.createPipeline;
    deletePipeline = mod.deletePipeline;
    generatePipeline = mod.generatePipeline;
    refinePipeline = mod.refinePipeline;
    runPipeline = mod.runPipeline;
});

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

afterEach(() => {
    mockFetch.mockReset();
});

function okJson(data: any) {
    return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(data),
    });
}

function okNoContent() {
    return Promise.resolve({ ok: true, status: 204, statusText: 'No Content' });
}

function errorResponse(status: number, statusText: string) {
    return Promise.resolve({ ok: false, status, statusText });
}

// ===========================================================================
// fetchPipelines
// ===========================================================================
describe('fetchPipelines', () => {
    it('sends GET to correct URL with encoded workspace ID', async () => {
        mockFetch.mockReturnValue(okJson({ pipelines: [{ name: 'p1', path: '/p1' }] }));
        const result = await fetchPipelines('ws/special');
        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws%2Fspecial/pipelines'
        );
        expect(result).toEqual([{ name: 'p1', path: '/p1' }]);
    });

    it('unwraps pipelines array from response envelope', async () => {
        const pipelines = [
            { name: 'a', path: '/a', description: 'desc', isValid: true },
            { name: 'b', path: '/b', isValid: false, validationErrors: ['err'] },
        ];
        mockFetch.mockReturnValue(okJson({ pipelines }));
        const result = await fetchPipelines('ws1');
        expect(result).toEqual(pipelines);
    });

    it('returns empty array when pipelines key is missing', async () => {
        mockFetch.mockReturnValue(okJson({}));
        const result = await fetchPipelines('ws1');
        expect(result).toEqual([]);
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValue(errorResponse(404, 'Not Found'));
        await expect(fetchPipelines('ws1')).rejects.toThrow('API error: 404 Not Found');
    });
});

// ===========================================================================
// fetchPipelineContent
// ===========================================================================
describe('fetchPipelineContent', () => {
    it('sends GET to correct URL with encoded names', async () => {
        const data = { content: 'yaml: true', path: '/p/pipeline.yaml' };
        mockFetch.mockReturnValue(okJson(data));
        const result = await fetchPipelineContent('ws1', 'my pipeline');
        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines/my%20pipeline/content'
        );
        expect(result).toEqual(data);
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValue(errorResponse(500, 'Internal Server Error'));
        await expect(fetchPipelineContent('ws1', 'p1')).rejects.toThrow('API error: 500');
    });
});

// ===========================================================================
// savePipelineContent
// ===========================================================================
describe('savePipelineContent', () => {
    it('sends PATCH with JSON body and Content-Type header', async () => {
        mockFetch.mockReturnValue(okNoContent());
        await savePipelineContent('ws1', 'p1', 'name: test');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines/p1/content',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: 'name: test' }),
            }
        );
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValue(errorResponse(400, 'Bad Request'));
        await expect(savePipelineContent('ws1', 'p1', '')).rejects.toThrow('API error: 400');
    });
});

// ===========================================================================
// createPipeline
// ===========================================================================
describe('createPipeline', () => {
    it('sends POST with name in body', async () => {
        mockFetch.mockReturnValue(okJson({}));
        await createPipeline('ws1', 'new-pipeline');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'new-pipeline' }),
            }
        );
    });

    it('includes template when provided', async () => {
        mockFetch.mockReturnValue(okJson({}));
        await createPipeline('ws1', 'new-pipeline', 'basic');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ name: 'new-pipeline', template: 'basic' });
    });

    it('omits template from body when undefined', async () => {
        mockFetch.mockReturnValue(okJson({}));
        await createPipeline('ws1', 'new-pipeline');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ name: 'new-pipeline' });
        expect('template' in body).toBe(false);
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValue(errorResponse(409, 'Conflict'));
        await expect(createPipeline('ws1', 'dup')).rejects.toThrow('API error: 409');
    });

    it('includes content in body when provided', async () => {
        mockFetch.mockReturnValue(okJson({}));
        await createPipeline('ws1', 'gen-pipe', undefined, 'yaml: content');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ name: 'gen-pipe', content: 'yaml: content' });
        expect('template' in body).toBe(false);
    });

    it('includes both template and content when both provided', async () => {
        mockFetch.mockReturnValue(okJson({}));
        await createPipeline('ws1', 'gen-pipe', 'custom', 'yaml: content');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ name: 'gen-pipe', template: 'custom', content: 'yaml: content' });
    });
});

// ===========================================================================
// generatePipeline
// ===========================================================================
describe('generatePipeline', () => {
    it('sends POST to correct URL with name and description', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'name: test', valid: true }));
        await generatePipeline('ws1', 'my-pipe', 'classify tickets');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines/generate',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: 'classify tickets', name: 'my-pipe' }),
                signal: undefined,
            }
        );
    });

    it('omits name from body when undefined', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'name: test', valid: true }));
        await generatePipeline('ws1', undefined, 'classify tickets');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ description: 'classify tickets' });
        expect('name' in body).toBe(false);
    });

    it('omits name from body when empty string', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'name: test', valid: true }));
        await generatePipeline('ws1', '', 'classify tickets');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ description: 'classify tickets' });
        expect('name' in body).toBe(false);
    });

    it('returns parsed { yaml, valid, validationError, suggestedName } response', async () => {
        const response = { yaml: 'name: test\ninput:\n  type: csv', valid: true, validationError: undefined, suggestedName: 'test' };
        mockFetch.mockReturnValue(okJson(response));
        const result = await generatePipeline('ws1', 'pipe', 'do stuff');
        expect(result).toEqual(response);
    });

    it('passes AbortSignal to fetch when provided', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'x', valid: true }));
        const controller = new AbortController();
        await generatePipeline('ws1', 'pipe', 'desc', controller.signal);

        const call = mockFetch.mock.calls[0];
        expect(call[1].signal).toBe(controller.signal);
    });

    it('throws on non-ok response with error body', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({ error: 'AI unavailable' }),
        }));
        await expect(generatePipeline('ws1', 'pipe', 'desc')).rejects.toThrow('AI unavailable');
    });

    it('throws generic message when error body is unparseable', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.reject(new Error('not json')),
        }));
        await expect(generatePipeline('ws1', 'pipe', 'desc')).rejects.toThrow('API error: 500 Internal Server Error');
    });

    it('encodes workspace ID in URL', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'x', valid: true }));
        await generatePipeline('ws/special', 'pipe', 'desc');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws%2Fspecial/pipelines/generate',
            expect.any(Object)
        );
    });
});

// ===========================================================================
// refinePipeline
// ===========================================================================
describe('refinePipeline', () => {
    it('sends POST to correct URL with instruction and currentYaml', async () => {
        const response = { yaml: 'name: refined', valid: true, suggestedName: 'foo' };
        mockFetch.mockReturnValue(okJson(response));
        const result = await refinePipeline('ws1', 'my-pipeline', 'add logging step', 'name: original');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines/my-pipeline/refine',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction: 'add logging step', currentYaml: 'name: original' }),
                signal: undefined,
            }
        );
        expect(result).toEqual(response);
    });

    it('includes model in body when provided', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'x', valid: true }));
        await refinePipeline('ws1', 'p1', 'add step', 'yaml', 'gpt-4');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ instruction: 'add step', currentYaml: 'yaml', model: 'gpt-4' });
    });

    it('omits model from body when undefined', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'x', valid: true }));
        await refinePipeline('ws1', 'p1', 'add step', 'yaml');

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body).toEqual({ instruction: 'add step', currentYaml: 'yaml' });
        expect('model' in body).toBe(false);
    });

    it('passes AbortSignal to fetch when provided', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'x', valid: true }));
        const controller = new AbortController();
        await refinePipeline('ws1', 'p1', 'add step', 'yaml', undefined, controller.signal);

        const call = mockFetch.mock.calls[0];
        expect(call[1].signal).toBe(controller.signal);
    });

    it('encodes workspace ID and pipeline name in URL', async () => {
        mockFetch.mockReturnValue(okJson({ yaml: 'x', valid: true }));
        await refinePipeline('ws/special', 'my pipeline', 'add step', 'yaml');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws%2Fspecial/pipelines/my%20pipeline/refine',
            expect.any(Object)
        );
    });

    it('throws on non-ok response with error body', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({ error: 'AI unavailable' }),
        }));
        await expect(refinePipeline('ws1', 'p1', 'add step', 'yaml')).rejects.toThrow('AI unavailable');
    });

    it('throws generic message when error body is unparseable', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.reject(new Error('not json')),
        }));
        await expect(refinePipeline('ws1', 'p1', 'add step', 'yaml')).rejects.toThrow('API error: 500 Internal Server Error');
    });
});

// ===========================================================================
// deletePipeline
// ===========================================================================
describe('deletePipeline', () => {
    it('sends DELETE with correct URL and no body', async () => {
        mockFetch.mockReturnValue(okNoContent());
        await deletePipeline('ws1', 'old-pipeline');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines/old-pipeline',
            { method: 'DELETE' }
        );
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValue(errorResponse(404, 'Not Found'));
        await expect(deletePipeline('ws1', 'missing')).rejects.toThrow('API error: 404');
    });
});

// ===========================================================================
// runPipeline
// ===========================================================================
describe('runPipeline', () => {
    it('sends POST to correct URL with empty JSON body', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: true, status: 201, statusText: 'Created',
            json: () => Promise.resolve({ task: { id: 'abc-12345678' } }),
        }));
        const result = await runPipeline('ws1', 'my-pipeline');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws1/pipelines/my-pipeline/run',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }
        );
        expect(result).toEqual({ task: { id: 'abc-12345678' } });
    });

    it('encodes workspace ID and pipeline name in URL', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: true, status: 201, statusText: 'Created',
            json: () => Promise.resolve({ task: { id: 'x' } }),
        }));
        await runPipeline('ws/special', 'my pipeline');

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/workspaces/ws%2Fspecial/pipelines/my%20pipeline/run',
            expect.any(Object)
        );
    });

    it('throws on non-ok response with error body', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false, status: 500, statusText: 'Internal Server Error',
            json: () => Promise.resolve({ error: 'Pipeline not found' }),
        }));
        await expect(runPipeline('ws1', 'missing')).rejects.toThrow('Pipeline not found');
    });

    it('throws generic message when error body is unparseable', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false, status: 500, statusText: 'Internal Server Error',
            json: () => Promise.reject(new Error('not json')),
        }));
        await expect(runPipeline('ws1', 'p1')).rejects.toThrow('API error: 500 Internal Server Error');
    });
});

// ===========================================================================
// PipelineInfo type compatibility
// ===========================================================================
describe('PipelineInfo type', () => {
    it('is exported from repoGrouping.ts', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'repoGrouping.ts'),
            'utf-8'
        );
        expect(source).toContain('export interface PipelineInfo');
    });

    it('RepoData.pipelines uses PipelineInfo[] type', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'repoGrouping.ts'),
            'utf-8'
        );
        expect(source).toContain('pipelines?: PipelineInfo[]');
    });

    it('old inline type is structurally compatible with PipelineInfo', () => {
        // TypeScript structural check: an object with only { name, path } should be assignable
        const oldShape: { name: string; path: string } = { name: 'test', path: '/test' };
        // This import proves structural compatibility at the type level
        const asInfo: import('../../../src/server/spa/client/react/repos/repoGrouping').PipelineInfo = oldShape;
        expect(asInfo.name).toBe('test');
        expect(asInfo.description).toBeUndefined();
    });
});

// ===========================================================================
// ReposView WS integration (source-level checks)
// ===========================================================================
describe('ReposView WebSocket integration', () => {
    const reposViewSource = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ReposView.tsx'),
        'utf-8'
    );

    it('imports useWebSocket hook', () => {
        expect(reposViewSource).toContain("import { useWebSocket }");
    });

    it('imports fetchPipelines from pipeline-api', () => {
        expect(reposViewSource).toContain("import { fetchPipelines } from './pipeline-api'");
    });

    it('handles pipelines-changed message type', () => {
        expect(reposViewSource).toContain("msg.type === 'pipelines-changed'");
    });

    it('calls connect on mount and disconnect on unmount', () => {
        expect(reposViewSource).toContain('connect()');
        expect(reposViewSource).toContain('disconnect()');
    });

    it('performs selective refresh by updating only the matching workspace', () => {
        expect(reposViewSource).toContain('r.workspace.id === wsId');
    });

    it('checks for workspaceId before refreshing (no-op for unknown)', () => {
        expect(reposViewSource).toContain('msg.workspaceId');
    });
});
