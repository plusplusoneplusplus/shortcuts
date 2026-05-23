/**
 * Tests for model-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerModelRoutes } from '../../src/server/models/model-routes';
import type { ModelStore, ModelRouteOptions } from '../../src/server/models/model-routes';
import type { Route } from '../../src/server/types';
import type { ModelInfo } from '@plusplusoneplusplus/forge';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../src/config';

// ── Helpers ──────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function makeServer(store: ModelStore, options?: ModelRouteOptions): http.Server {
    const routes: Route[] = [];
    registerModelRoutes(routes, store, options);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiGet(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json();
    return { status: res.status, body };
}

async function apiPut(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.json();
    return { status: res.status, body };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeModelInfo(id: string, name: string, contextWindow = 128_000): ModelInfo {
    return {
        id,
        name,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: contextWindow },
        },
    };
}

function makeReasoningModelInfo(id: string, supportedReasoningEfforts: string[], defaultReasoningEffort: string): ModelInfo {
    return {
        id,
        name: id,
        capabilities: {
            supports: {
                vision: false,
                reasoningEffort: true,
                reasoning_effort: supportedReasoningEfforts,
            },
            limits: { max_context_window_tokens: 128_000 },
        },
        supportedReasoningEfforts,
        defaultReasoningEffort,
    };
}

const THREE_MODELS: ModelInfo[] = [
    makeModelInfo('model-a', 'Model A'),
    makeModelInfo('model-b', 'Model B'),
    makeModelInfo('model-c', 'Model C', 200_000),
];

function makeOptions(initialConfig?: CLIConfig): ModelRouteOptions & { writtenConfig: CLIConfig | undefined } {
    let storedConfig: CLIConfig | undefined = initialConfig;
    const result = {
        writtenConfig: undefined as CLIConfig | undefined,
        loadConfigFile: (_p?: string) => storedConfig,
        writeConfigFile: (_p: string, c: CLIConfig) => {
            storedConfig = c;
            result.writtenConfig = c;
        },
        getConfigFilePath: () => '/fake/config.yaml',
    };
    return result;
}

function makeAiService(sendMessage: ISDKService['sendMessage']): ISDKService {
    return {
        isAvailable: async () => ({ available: true }),
        clearAvailabilityCache: () => undefined,
        listModels: async () => [],
        sendMessage,
        transform: async () => '',
        forkSession: async () => 'forked',
        abortSession: async () => false,
        softAbortSession: async () => false,
        steerSession: async () => false,
        hasActiveSession: () => false,
        getActiveSessionCount: () => 0,
        cleanup: async () => undefined,
        dispose: () => undefined,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/models', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns store data when store is populated', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(200);
        expect(body).toEqual(THREE_MODELS);
    });

    it('falls back to dynamic list from model registry when store is empty', async () => {
        const store: ModelStore = { getAll: () => [] };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(200);
        const models = body as ModelInfo[];
        expect(models.length).toBeGreaterThan(0);
        // Fallback should include models from the current static registry
        const ids = models.map((m: ModelInfo) => m.id);
        expect(ids).toContain('claude-sonnet-4.6');
        expect(ids).toContain('claude-haiku-4.5');
    });

    it('returns 500 when store.getAll() throws', async () => {
        const store: ModelStore = {
            getAll: () => {
                throw new Error('db error');
            },
        };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(500);
        expect((body as { error: string }).error).toBe('db error');
    });

    it('POST /api/models is not matched (404)', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store);
        await startServer();

        const res = await fetch(`${baseUrl}/api/models`, { method: 'POST' });
        expect(res.status).toBe(404);
    });

    it('includes enabled:false for all models when no config exists', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiGet('/api/models');
        expect(status).toBe(200);
        const models = body as Array<ModelInfo & { enabled: boolean }>;
        expect(models).toHaveLength(3);
        expect(models.every(m => m.enabled === false)).toBe(true);
    });

    it('passes supportedReasoningEfforts and defaultReasoningEffort from the SDK store through verbatim', async () => {
        const store: ModelStore = {
            getAll: () => [
                makeReasoningModelInfo('reasoning-a', ['low', 'medium', 'high'], 'medium'),
                makeReasoningModelInfo('reasoning-b', ['high', 'xhigh'], 'high'),
            ],
        };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(200);
        const models = body as Array<ModelInfo & { id: string }>;
        expect(models).toHaveLength(2);
        const byId = Object.fromEntries(models.map(m => [m.id, m]));
        expect(byId['reasoning-a'].supportedReasoningEfforts).toEqual(['low', 'medium', 'high']);
        expect(byId['reasoning-a'].defaultReasoningEffort).toBe('medium');
        expect(byId['reasoning-a'].capabilities.supports.reasoning_effort).toEqual(['low', 'medium', 'high']);
        expect(byId['reasoning-b'].supportedReasoningEfforts).toEqual(['high', 'xhigh']);
        expect(byId['reasoning-b'].defaultReasoningEffort).toBe('high');
    });

    it('marks only whitelisted models as enabled', async () => {
        const opts = makeOptions({ models: { enabled: ['model-a', 'model-c'] } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiGet('/api/models');
        expect(status).toBe(200);
        const models = body as Array<{ id: string; enabled: boolean }>;
        const byId = Object.fromEntries(models.map(m => [m.id, m.enabled]));
        expect(byId['model-a']).toBe(true);
        expect(byId['model-b']).toBe(false);
        expect(byId['model-c']).toBe(true);
    });
});

describe('GET /api/models/enabled', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns empty array when no config', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiGet('/api/models/enabled');
        expect(status).toBe(200);
        expect((body as { enabledModels: string[] }).enabledModels).toEqual([]);
    });

    it('returns configured enabled models', async () => {
        const opts = makeOptions({ models: { enabled: ['model-a', 'model-b'] } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiGet('/api/models/enabled');
        expect(status).toBe(200);
        expect((body as { enabledModels: string[] }).enabledModels).toEqual(['model-a', 'model-b']);
    });

    it('not registered when no options provided', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store); // no options
        await startServer();

        const res = await fetch(`${baseUrl}/api/models/enabled`);
        expect(res.status).toBe(404);
    });
});

describe('POST /api/models/query', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('queries the active AI service with prompt and model', async () => {
        let received: unknown;
        const opts = makeOptions(undefined);
        opts.aiService = makeAiService(async (options) => {
            received = options;
            return { success: true, response: 'pong', sessionId: 'sess-1' };
        });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const res = await fetch(`${baseUrl}/api/models/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'ping', model: 'model-a', timeoutMs: 5000 }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toMatchObject({ success: true, response: 'pong', model: 'model-a', sessionId: 'sess-1' });
        expect(body.durationMs).toEqual(expect.any(Number));
        expect(received).toMatchObject({ prompt: 'ping', model: 'model-a', timeoutMs: 5000, mode: 'interactive' });
    });

    it('returns 400 when prompt is missing', async () => {
        const opts = makeOptions(undefined);
        opts.aiService = makeAiService(async () => ({ success: true, response: 'unused' }));
        server = makeServer({ getAll: () => THREE_MODELS }, opts);
        await startServer();

        const res = await fetch(`${baseUrl}/api/models/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'model-a' }),
        });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'prompt is required' });
    });

    it('returns 502 when the AI service fails', async () => {
        const opts = makeOptions(undefined);
        opts.aiService = makeAiService(async () => ({ success: false, error: 'model rejected request', sessionId: 'sess-2' }));
        server = makeServer({ getAll: () => THREE_MODELS }, opts);
        await startServer();

        const res = await fetch(`${baseUrl}/api/models/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'ping', model: 'model-a' }),
        });
        const body = await res.json();

        expect(res.status).toBe(502);
        expect(body).toMatchObject({ success: false, error: 'model rejected request', model: 'model-a', sessionId: 'sess-2' });
    });
});

describe('PUT /api/models/enabled', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('writes enabled models to config file', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiPut('/api/models/enabled', { enabledModels: ['model-a'] });
        expect(status).toBe(200);
        expect((body as { enabledModels: string[] }).enabledModels).toEqual(['model-a']);
        expect(opts.writtenConfig?.models?.enabled).toEqual(['model-a']);
    });

    it('returns 400 for invalid payload', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status } = await apiPut('/api/models/enabled', { enabledModels: 'not-an-array' });
        expect(status).toBe(400);
    });

    it('preserves other config fields when writing', async () => {
        const opts = makeOptions({ model: 'gpt-4', models: { enabled: ['model-a'] } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        await apiPut('/api/models/enabled', { enabledModels: ['model-b', 'model-c'] });
        expect(opts.writtenConfig?.model).toBe('gpt-4');
        expect(opts.writtenConfig?.models?.enabled).toEqual(['model-b', 'model-c']);
    });

    it('not registered when no options provided', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store); // no options
        await startServer();

        const res = await fetch(`${baseUrl}/api/models/enabled`, { method: 'PUT', body: '{}' });
        expect(res.status).toBe(404);
    });
});

describe('GET /api/models/reasoning-efforts', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns empty map when no config exists', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiGet('/api/models/reasoning-efforts');
        expect(status).toBe(200);
        expect((body as { reasoningEfforts: Record<string, string> }).reasoningEfforts).toEqual({});
    });

    it('returns persisted reasoning efforts', async () => {
        const opts = makeOptions({ models: { reasoningEfforts: { 'model-a': 'high', 'model-b': 'low' } } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiGet('/api/models/reasoning-efforts');
        expect(status).toBe(200);
        expect((body as { reasoningEfforts: Record<string, string> }).reasoningEfforts).toEqual({ 'model-a': 'high', 'model-b': 'low' });
    });

    it('not registered when no options provided', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store);
        await startServer();

        const res = await fetch(`${baseUrl}/api/models/reasoning-efforts`);
        expect(res.status).toBe(404);
    });
});

describe('PUT /api/models/reasoning-efforts', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('sets a reasoning effort for a model', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiPut('/api/models/reasoning-efforts', { modelId: 'model-a', effort: 'high' });
        expect(status).toBe(200);
        expect((body as { reasoningEfforts: Record<string, string> }).reasoningEfforts).toEqual({ 'model-a': 'high' });
        expect(opts.writtenConfig?.models?.reasoningEfforts).toEqual({ 'model-a': 'high' });
    });

    it('clears a reasoning effort when effort is empty string', async () => {
        const opts = makeOptions({ models: { reasoningEfforts: { 'model-a': 'high', 'model-b': 'low' } } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiPut('/api/models/reasoning-efforts', { modelId: 'model-a', effort: '' });
        expect(status).toBe(200);
        expect((body as { reasoningEfforts: Record<string, string> }).reasoningEfforts).toEqual({ 'model-b': 'low' });
        expect(opts.writtenConfig?.models?.reasoningEfforts).toEqual({ 'model-b': 'low' });
    });

    it('merges with existing reasoning efforts', async () => {
        const opts = makeOptions({ models: { reasoningEfforts: { 'model-a': 'high' } } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status, body } = await apiPut('/api/models/reasoning-efforts', { modelId: 'model-b', effort: 'xhigh' });
        expect(status).toBe(200);
        const efforts = (body as { reasoningEfforts: Record<string, string> }).reasoningEfforts;
        expect(efforts).toEqual({ 'model-a': 'high', 'model-b': 'xhigh' });
    });

    it('preserves other config fields when writing', async () => {
        const opts = makeOptions({ model: 'gpt-4', models: { enabled: ['model-a'] } });
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        await apiPut('/api/models/reasoning-efforts', { modelId: 'model-a', effort: 'low' });
        expect(opts.writtenConfig?.model).toBe('gpt-4');
        expect(opts.writtenConfig?.models?.enabled).toEqual(['model-a']);
        expect(opts.writtenConfig?.models?.reasoningEfforts).toEqual({ 'model-a': 'low' });
    });

    it('returns 400 when modelId is missing', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status } = await apiPut('/api/models/reasoning-efforts', { effort: 'high' });
        expect(status).toBe(400);
    });

    it('returns 400 when effort is missing', async () => {
        const opts = makeOptions(undefined);
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store, opts);
        await startServer();

        const { status } = await apiPut('/api/models/reasoning-efforts', { modelId: 'model-a' });
        expect(status).toBe(400);
    });
});
