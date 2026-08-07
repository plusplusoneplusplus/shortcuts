/**
 * Generate Handler Tests
 *
 * The handlers are thin HTTP adapters: request validation, 4xx shapes, registry
 * claiming, SSE headers, and status assembly. Generation itself is stubbed via
 * an injected DeepWikiAdapter, so nothing here reaches deep-wiki or the network.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import {
    handleStartGenerate,
    handleCancelGenerate,
    handleGetGenerateStatus,
    handleComponentRegenerate,
    getGenerationState,
    resetGenerationState,
    resetAllGenerationStates,
} from '../../../../src/server/wiki/generate-handler';
import { WikiGenerationRegistry } from '../../../../src/server/wiki/generation';
import { createSingleWikiProvider } from '../../../../src/server/wiki/wiki-backend';
import { createFakeAdapter, createFakeWiki, makeGraph } from './fakes';

let tempDir: string;
let wikiDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-gen-handler-'));
    wikiDir = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    resetAllGenerationStates();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetAllGenerationStates();
});

// ============================================================================
// Helpers
// ============================================================================

interface MockResponse extends ServerResponse {
    _chunks: string[];
    _status: number;
    _headers: Record<string, unknown>;
    _body(): any;
}

function createMockResponse(): MockResponse {
    const chunks: string[] = [];
    const res: any = {
        _chunks: chunks,
        _status: 0,
        _headers: {},
        destroyed: false,
        writableEnded: false,
        statusCode: 200,
        writeHead: vi.fn((status: number, headers?: Record<string, unknown>) => {
            res._status = status;
            Object.assign(res._headers, headers ?? {});
            return res;
        }),
        write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }),
        end: vi.fn((body?: Buffer) => { if (body) chunks.push(body.toString()); }),
        setHeader: vi.fn(),
        _body: () => JSON.parse(chunks.join('')),
    };
    return res as MockResponse;
}

function createMockRequest(body = '{}'): IncomingMessage {
    const emitter = new EventEmitter();
    process.nextTick(() => {
        if (body) emitter.emit('data', Buffer.from(body));
        emitter.emit('end');
    });
    return emitter as unknown as IncomingMessage;
}

/** SSE frames parsed back out of the mock response. */
function sseEvents(res: MockResponse): any[] {
    return res._chunks
        .filter((c) => c.startsWith('data: '))
        .map((c) => JSON.parse(c.slice('data: '.length).trim()));
}

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
};

// ============================================================================
// handleStartGenerate
// ============================================================================

describe('handleStartGenerate — validation', () => {
    it('404s for an unknown wiki', async () => {
        const provider = { get: () => undefined };
        const res = createMockResponse();

        await handleStartGenerate(createMockRequest(), res, 'missing', provider as any);

        expect(res._status).toBe(404);
        expect(res._body()).toEqual({ error: 'Wiki not found: missing' });
    });

    it('400s when the wiki has no repo path', async () => {
        const wiki = createFakeWiki(wikiDir, { repoPath: undefined });
        const res = createMockResponse();

        await handleStartGenerate(createMockRequest(), res, 'w1', createSingleWikiProvider(wiki as any));

        expect(res._status).toBe(400);
        expect(res._body()).toEqual({ error: 'No repository path configured for this wiki.' });
    });

    it('400s on a non-JSON body', async () => {
        const res = createMockResponse();

        await handleStartGenerate(
            createMockRequest('not json'),
            res,
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
        );

        expect(res._status).toBe(400);
        expect(res._body()).toEqual({ error: 'Request body must be valid JSON' });
    });

    it.each([
        [{ startPhase: 0 }, 'Invalid startPhase: 0. Must be 1-5.'],
        [{ startPhase: 6 }, 'Invalid startPhase: 6. Must be 1-5.'],
        [{ startPhase: 1.5 }, 'Invalid startPhase: 1.5. Must be 1-5.'],
        [{ endPhase: 0 }, 'Invalid endPhase: 0. Must be 1-5.'],
        [{ endPhase: 9 }, 'Invalid endPhase: 9. Must be 1-5.'],
        [{ startPhase: 4, endPhase: 2 }, 'endPhase (2) must be >= startPhase (4).'],
    ])('400s on invalid phase bounds %j', async (body, message) => {
        const res = createMockResponse();

        await handleStartGenerate(
            createMockRequest(JSON.stringify(body)),
            res,
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
        );

        expect(res._status).toBe(400);
        expect(res._body()).toEqual({ error: message });
    });

    it('409s when a generation is already running for the wiki', async () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 1);
        const res = createMockResponse();

        await handleStartGenerate(
            createMockRequest(),
            res,
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry },
        );

        expect(res._status).toBe(409);
        expect(res._body()).toEqual({ error: 'Generation already in progress for this wiki' });
    });
});

describe('handleStartGenerate — streaming', () => {
    it('streams the full phase sequence over SSE and releases the wiki', async () => {
        const registry = new WikiGenerationRegistry();
        const adapter = createFakeAdapter();
        const res = createMockResponse();

        await handleStartGenerate(
            createMockRequest('{}'),
            res,
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry, adapter },
        );

        expect(res._status).toBe(200);
        expect(res._headers).toMatchObject(SSE_HEADERS);
        expect(sseEvents(res).map((e) => e.type)).toEqual([
            'status', 'phase-complete',
            'status', 'phase-complete',
            'status', 'phase-complete',
            'status', 'phase-complete',
            'status', 'phase-complete',
            'log',
            'done',
        ]);
        expect(registry.isRunning('w1')).toBe(false);
        expect(res.end).toHaveBeenCalled();
    });

    it('defaults to phases 1 through 5', async () => {
        const adapter = createFakeAdapter();

        await handleStartGenerate(
            createMockRequest('{}'),
            createMockResponse(),
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry: new WikiGenerationRegistry(), adapter },
        );

        expect(adapter.calls.phases.runPhase1).toHaveBeenCalled();
        expect(adapter.calls.phases.runPhase5Website).toHaveBeenCalled();
    });

    it('honours an explicit phase range', async () => {
        const adapter = createFakeAdapter();

        await handleStartGenerate(
            createMockRequest(JSON.stringify({ startPhase: 1, endPhase: 1 })),
            createMockResponse(),
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry: new WikiGenerationRegistry(), adapter },
        );

        expect(adapter.calls.phases.runPhase1).toHaveBeenCalled();
        expect(adapter.calls.phases.runPhase2Consolidation).not.toHaveBeenCalled();
    });

    it('converts an unexpected runner throw into error + done events', async () => {
        const registry = new WikiGenerationRegistry();
        const adapter = createFakeAdapter();
        adapter.loadPhases = vi.fn(async () => { throw new Error('deep-wiki missing'); }) as any;
        const res = createMockResponse();

        await handleStartGenerate(
            createMockRequest('{}'),
            res,
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry, adapter },
        );

        expect(sseEvents(res)).toEqual([
            { type: 'error', message: 'deep-wiki missing' },
            { type: 'done', success: false, error: 'deep-wiki missing' },
        ]);
        expect(registry.isRunning('w1')).toBe(false);
    });

    it('marks the wiki running while the generation is in flight', async () => {
        const registry = new WikiGenerationRegistry();
        let runningDuringPhase: boolean | undefined;
        const adapter = createFakeAdapter({
            phases: {
                runPhase1: vi.fn(async () => {
                    runningDuringPhase = registry.isRunning('w1');
                    return { graph: makeGraph(['auth']) };
                }),
            },
        });

        await handleStartGenerate(
            createMockRequest(JSON.stringify({ startPhase: 1, endPhase: 1 })),
            createMockResponse(),
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry, adapter },
        );

        expect(runningDuringPhase).toBe(true);
    });
});

// ============================================================================
// handleCancelGenerate
// ============================================================================

describe('handleCancelGenerate', () => {
    it('cancels a running generation', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 1)!;
        const res = createMockResponse();

        handleCancelGenerate(res, 'w1', { registry });

        expect(res._body()).toEqual({ success: true });
        expect(handle.isCancelled()).toBe(true);
    });

    it('reports 200 with success:false when nothing is running', () => {
        const res = createMockResponse();

        handleCancelGenerate(res, 'w1', { registry: new WikiGenerationRegistry() });

        expect(res._status).toBe(200);
        expect(res._body()).toEqual({ success: false, error: 'No generation in progress for this wiki' });
    });

    it('cancelling one wiki leaves another running', () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 1);
        const other = registry.start('w2', 1)!;

        handleCancelGenerate(createMockResponse(), 'w1', { registry });

        expect(other.isCancelled()).toBe(false);
    });

    it('stops an in-flight run mid-generation', async () => {
        const registry = new WikiGenerationRegistry();
        const adapter = createFakeAdapter({
            phases: {
                runPhase1: vi.fn(async () => {
                    handleCancelGenerate(createMockResponse(), 'w1', { registry });
                    return { graph: makeGraph(['auth']) };
                }),
            },
        });
        const res = createMockResponse();

        await handleStartGenerate(
            createMockRequest('{}'),
            res,
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { registry, adapter },
        );

        expect(sseEvents(res).pop()).toEqual({ type: 'done', success: false, error: 'Cancelled' });
        expect(adapter.calls.phases.runPhase2Consolidation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// handleGetGenerateStatus
// ============================================================================

describe('handleGetGenerateStatus', () => {
    it('404s for an unknown wiki', () => {
        const res = createMockResponse();

        handleGetGenerateStatus(res, 'missing', { get: () => undefined } as any);

        expect(res._status).toBe(404);
        expect(res._body()).toEqual({ error: 'Wiki not found: missing' });
    });

    it('reports available:false and no phases without a repo path', () => {
        const wiki = createFakeWiki(wikiDir, { repoPath: undefined });
        const res = createMockResponse();

        handleGetGenerateStatus(res, 'w1', createSingleWikiProvider(wiki as any));

        const body = res._body();
        expect(body.available).toBe(false);
        expect(body.phases).toEqual({});
        expect(body.repoPath).toBeUndefined();
        expect(body.metadata.components).toBe(1);
    });

    it('reports per-phase cache status and metadata when a repo path is set', () => {
        const cacheDir = path.join(wikiDir, '.wiki-cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            path.join(cacheDir, 'component-graph.json'),
            JSON.stringify({ timestamp: '2024-01-01T00:00:00.000Z' }),
            'utf-8',
        );
        const res = createMockResponse();

        handleGetGenerateStatus(res, 'w1', createSingleWikiProvider(createFakeWiki(wikiDir) as any));

        const body = res._body();
        expect(body.available).toBe(true);
        expect(body.repoPath).toBe('/repo');
        expect(body.phases['1']).toEqual({ cached: true, timestamp: '2024-01-01T00:00:00.000Z' });
        expect(body.phases['2'].cached).toBe(false);
        expect(body.phases['4'].components).toEqual({ auth: { cached: false } });
        expect(body.metadata).toMatchObject({ components: 1, projectName: 'Test', projectLanguage: 'TypeScript' });
    });

    it('surfaces the running phase from the injected registry', () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 1)!.setPhase(3);
        const res = createMockResponse();

        handleGetGenerateStatus(res, 'w1', createSingleWikiProvider(createFakeWiki(wikiDir) as any), { registry });

        expect(res._body()).toMatchObject({ running: true, currentPhase: 3 });
    });

    it('reports not running when the registry is idle', () => {
        const res = createMockResponse();

        handleGetGenerateStatus(res, 'w1', createSingleWikiProvider(createFakeWiki(wikiDir) as any), {
            registry: new WikiGenerationRegistry(),
        });

        expect(res._body().running).toBe(false);
    });
});

// ============================================================================
// handleComponentRegenerate
// ============================================================================

describe('handleComponentRegenerate', () => {
    function provider(options: { repoPath?: string; componentDetail?: any } = {}) {
        return createSingleWikiProvider(createFakeWiki(wikiDir, {
            graph: makeGraph(['auth']),
            ...options,
        }) as any);
    }

    it('404s for an unknown wiki', async () => {
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'missing', 'auth', { get: () => undefined } as any);

        expect(res._status).toBe(404);
    });

    it('503s when the wiki has no repo path', async () => {
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'w1', 'auth', provider({ repoPath: undefined }));

        expect(res._status).toBe(503);
        expect(res._body()).toEqual({ error: 'No repository path configured.' });
    });

    it('409s when a generation is already running', async () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 1);
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'w1', 'auth', provider(), { registry });

        expect(res._status).toBe(409);
        expect(res._body()).toEqual({ error: 'A generation is already in progress for this wiki' });
    });

    it('404s for a component that is not in the graph', async () => {
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'w1', 'ghost', provider(), {
            registry: new WikiGenerationRegistry(),
            adapter: createFakeAdapter(),
        });

        expect(res._status).toBe(404);
        expect(res._body()).toEqual({ error: 'Component not found: ghost' });
    });

    it('412s when no analysis is cached for the component', async () => {
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'w1', 'auth', provider(), {
            registry: new WikiGenerationRegistry(),
            adapter: createFakeAdapter(),
        });

        expect(res._status).toBe(412);
        expect(res._body()).toEqual({
            error: 'No analysis cached for component "auth". Run Phase 3 (Analysis) first.',
        });
    });

    it('falls back to the loaded component detail analysis', async () => {
        const adapter = createFakeAdapter();
        const res = createMockResponse();

        await handleComponentRegenerate(
            createMockRequest(),
            res,
            'w1',
            'auth',
            provider({ componentDetail: { analysis: { componentId: 'auth' } } }),
            { registry: new WikiGenerationRegistry(), adapter },
        );

        expect(res._status).toBe(200);
        expect(sseEvents(res).pop()).toMatchObject({ type: 'done', success: true, componentId: 'auth' });
    });

    it('streams the regeneration over SSE and releases the wiki', async () => {
        const registry = new WikiGenerationRegistry();
        const adapter = createFakeAdapter({ cache: { getCachedAnalysis: () => ({ componentId: 'auth' }) } });
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'w1', 'auth', provider(), { registry, adapter });

        expect(res._headers).toMatchObject(SSE_HEADERS);
        expect(sseEvents(res).map((e) => e.type)).toEqual(['status', 'log', 'log', 'log', 'done']);
        expect(registry.isRunning('w1')).toBe(false);
    });

    it('converts an unexpected throw into error + done events carrying the component id', async () => {
        const registry = new WikiGenerationRegistry();
        const adapter = createFakeAdapter({ cache: { getCachedAnalysis: () => ({ componentId: 'auth' }) } });
        adapter.loadArticleWriter = vi.fn(async () => { throw new Error('writer missing'); }) as any;
        const res = createMockResponse();

        await handleComponentRegenerate(createMockRequest(), res, 'w1', 'auth', provider(), { registry, adapter });

        expect(sseEvents(res).slice(-2)).toEqual([
            { type: 'error', message: 'writer missing' },
            { type: 'done', success: false, componentId: 'auth', error: 'writer missing' },
        ]);
        expect(registry.isRunning('w1')).toBe(false);
    });
});

// ============================================================================
// Default-registry test helpers
// ============================================================================

describe('default registry test helpers', () => {
    it('report null for wikis with no generation state', () => {
        expect(getGenerationState('w1')).toBeNull();
        expect(getGenerationState('w2')).toBeNull();
    });

    it('resetGenerationState clears a single wiki', async () => {
        const adapter = createFakeAdapter();
        let stateDuringRun: unknown;
        adapter.calls.phases.runPhase1.mockImplementation(async () => {
            // Snapshot — finish() mutates the live state object in place.
            stateDuringRun = { ...getGenerationState('w1')! };
            return { graph: makeGraph(['auth']) };
        });

        await handleStartGenerate(
            createMockRequest(JSON.stringify({ startPhase: 1, endPhase: 1 })),
            createMockResponse(),
            'w1',
            createSingleWikiProvider(createFakeWiki(wikiDir) as any),
            { adapter },
        );

        expect(stateDuringRun).toMatchObject({ running: true, currentPhase: 1 });
        expect(getGenerationState('w1')).toBeNull();

        resetGenerationState('w1');
        expect(getGenerationState('w1')).toBeNull();
    });
});
