/**
 * Tests for provider-scoped model routes on agent-providers.
 *
 * Validates GET/PUT /api/agent-providers/:provider/models/* endpoints
 * using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerAgentProvidersRoutes } from '../../src/server/agent-providers/agent-providers-routes';
import type { AgentProvidersRouteContext } from '../../src/server/agent-providers/agent-providers-routes';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';
import type { Route } from '../../src/server/types';
import type { CLIConfig } from '../../src/config';
import type { ModelInfo, ISDKService } from '@plusplusoneplusplus/forge';

// Mock modelMetadataStore from forge
const mockGetAll = vi.fn<() => ModelInfo[]>().mockReturnValue([]);
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        modelMetadataStore: {
            getAll: (...args: unknown[]) => mockGetAll(...(args as [])),
        },
    };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

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

const THREE_MODELS: ModelInfo[] = [
    makeModelInfo('model-a', 'Model A'),
    makeModelInfo('model-b', 'Model B'),
    makeModelInfo('model-c', 'Model C', 200_000),
];

function makeRuntimeConfigService(config: Record<string, unknown> = {}): RuntimeConfigService {
    return new RuntimeConfigService({
        fileConfig: { codex: { enabled: false }, claude: { enabled: false }, ...config },
    });
}

function makeConfigFunctions(initialConfig?: CLIConfig): {
    storedConfig: CLIConfig | undefined;
    writtenConfig: CLIConfig | undefined;
    loadConfigFile: (p?: string) => CLIConfig | undefined;
    writeConfigFile: (p: string, c: CLIConfig) => void;
    getConfigFilePath: () => string;
} {
    let storedConfig: CLIConfig | undefined = initialConfig;
    const result = {
        get storedConfig() { return storedConfig; },
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

function makeAiService(overrides?: Partial<ISDKService>): ISDKService {
    return {
        isAvailable: async () => ({ available: true }),
        clearAvailabilityCache: () => undefined,
        listModels: async () => [],
        sendMessage: async () => ({ success: true, response: 'test response', sessionId: 'sess-1' }),
        transform: async () => '',
        forkSession: async () => 'forked',
        abortSession: async () => false,
        softAbortSession: async () => false,
        steerSession: async () => false,
        hasActiveSession: () => false,
        getActiveSessionCount: () => 0,
        cleanup: async () => undefined,
        dispose: () => undefined,
        ...overrides,
    };
}

function makeCtx(overrides?: Partial<AgentProvidersRouteContext>): AgentProvidersRouteContext {
    const cfgFns = makeConfigFunctions();
    return {
        runtimeConfigService: makeRuntimeConfigService(),
        getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
        getClaudeAvailability: async () => ({ available: false, error: 'not installed' }),
        serverBaseUrl: 'http://localhost:4000',
        loadConfigFile: cfgFns.loadConfigFile,
        writeConfigFile: cfgFns.writeConfigFile,
        getConfigFilePath: cfgFns.getConfigFilePath,
        ...overrides,
    };
}

function makeServer(ctx: AgentProvidersRouteContext): http.Server {
    const routes: Route[] = [];
    registerAgentProvidersRoutes(routes, ctx);
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

async function apiPost(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.json();
    return { status: res.status, body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/agent-providers/:provider/models', () => {
    afterEach(async () => {
        await stopServer();
        mockGetAll.mockReset();
    });

    it('returns models with enabled flag from modelMetadataStore for copilot', async () => {
        mockGetAll.mockReturnValue(THREE_MODELS);
        const cfgFns = makeConfigFunctions({ models: { providers: { copilot: { enabled: ['model-a'] } } } });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/models');
        expect(status).toBe(200);
        const data = body as { provider: string; models: Array<ModelInfo & { enabled: boolean }> };
        expect(data.provider).toBe('copilot');
        expect(data.models).toHaveLength(3);
        expect(data.models.find(m => m.id === 'model-a')?.enabled).toBe(true);
        expect(data.models.find(m => m.id === 'model-b')?.enabled).toBe(false);
    });

    it('falls back to static models when store is empty', async () => {
        mockGetAll.mockReturnValue([]);
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/models');
        expect(status).toBe(200);
        const data = body as { provider: string; models: ModelInfo[] };
        expect(data.provider).toBe('copilot');
        expect(data.models.length).toBeGreaterThan(0);
        // Should contain known static models
        const ids = data.models.map(m => m.id);
        expect(ids).toContain('claude-sonnet-4.6');
    });

    it('returns 400 for invalid provider', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/invalid/models');
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid provider');
    });

    it('returns empty models for codex when no SDK service', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/codex/models');
        expect(status).toBe(200);
        const data = body as { provider: string; models: ModelInfo[] };
        expect(data.provider).toBe('codex');
        expect(data.models).toEqual([]);
    });
});

describe('GET /api/agent-providers/:provider/models/enabled', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns enabled models for copilot', async () => {
        const cfgFns = makeConfigFunctions({
            models: { providers: { copilot: { enabled: ['model-a', 'model-b'] } } },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/models/enabled');
        expect(status).toBe(200);
        const data = body as { provider: string; enabledModels: string[] };
        expect(data.provider).toBe('copilot');
        expect(data.enabledModels).toEqual(['model-a', 'model-b']);
    });

    it('reads from global models.enabled for copilot when no provider-scoped settings exist (legacy migration)', async () => {
        const cfgFns = makeConfigFunctions({
            models: { enabled: ['legacy-model-1', 'legacy-model-2'] },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/models/enabled');
        expect(status).toBe(200);
        const data = body as { provider: string; enabledModels: string[] };
        expect(data.enabledModels).toEqual(['legacy-model-1', 'legacy-model-2']);
    });

    it('returns empty for codex when no settings exist (provider isolation)', async () => {
        const cfgFns = makeConfigFunctions({
            models: { enabled: ['legacy-model-1'] },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/codex/models/enabled');
        expect(status).toBe(200);
        const data = body as { provider: string; enabledModels: string[] };
        expect(data.provider).toBe('codex');
        expect(data.enabledModels).toEqual([]);
    });

    it('returns empty for claude when no settings exist (provider isolation)', async () => {
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/claude/models/enabled');
        expect(status).toBe(200);
        const data = body as { provider: string; enabledModels: string[] };
        expect(data.provider).toBe('claude');
        expect(data.enabledModels).toEqual([]);
    });
});

describe('PUT /api/agent-providers/:provider/models/enabled', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('writes to provider-scoped config', async () => {
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/models/enabled', {
            enabledModels: ['model-a', 'model-c'],
        });
        expect(status).toBe(200);
        const data = body as { provider: string; enabledModels: string[] };
        expect(data.provider).toBe('copilot');
        expect(data.enabledModels).toEqual(['model-a', 'model-c']);

        // Verify written config has provider-scoped structure
        expect(cfgFns.writtenConfig?.models?.providers?.copilot?.enabled).toEqual(['model-a', 'model-c']);
    });

    it('returns 400 for invalid enabledModels', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/models/enabled', {
            enabledModels: 'not-an-array',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('enabledModels must be an array');
    });
});

describe('GET /api/agent-providers/:provider/models/reasoning-efforts', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns reasoning efforts for copilot', async () => {
        const cfgFns = makeConfigFunctions({
            models: { providers: { copilot: { reasoningEfforts: { 'model-x': 'high' } } } },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/models/reasoning-efforts');
        expect(status).toBe(200);
        const data = body as { provider: string; reasoningEfforts: Record<string, string> };
        expect(data.provider).toBe('copilot');
        expect(data.reasoningEfforts).toEqual({ 'model-x': 'high' });
    });

    it('falls back to global reasoningEfforts for copilot (legacy)', async () => {
        const cfgFns = makeConfigFunctions({
            models: { reasoningEfforts: { 'model-y': 'low' } },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/models/reasoning-efforts');
        expect(status).toBe(200);
        const data = body as { provider: string; reasoningEfforts: Record<string, string> };
        expect(data.reasoningEfforts).toEqual({ 'model-y': 'low' });
    });
});

describe('PUT /api/agent-providers/:provider/models/reasoning-efforts', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('writes provider-scoped reasoning effort', async () => {
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/models/reasoning-efforts', {
            modelId: 'model-x',
            effort: 'high',
        });
        expect(status).toBe(200);
        const data = body as { provider: string; reasoningEfforts: Record<string, string> };
        expect(data.provider).toBe('copilot');
        expect(data.reasoningEfforts).toEqual({ 'model-x': 'high' });

        expect(cfgFns.writtenConfig?.models?.providers?.copilot?.reasoningEfforts).toEqual({ 'model-x': 'high' });
    });

    it('clears effort with empty string', async () => {
        const cfgFns = makeConfigFunctions({
            models: { providers: { copilot: { reasoningEfforts: { 'model-x': 'high', 'model-y': 'low' } } } },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/models/reasoning-efforts', {
            modelId: 'model-x',
            effort: '',
        });
        expect(status).toBe(200);
        const data = body as { provider: string; reasoningEfforts: Record<string, string> };
        expect(data.reasoningEfforts).toEqual({ 'model-y': 'low' });
    });

    it('returns 400 for missing modelId', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/models/reasoning-efforts', {
            effort: 'high',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('modelId is required');
    });
});

describe('POST /api/agent-providers/:provider/models/query', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('queries the SDK service for copilot', async () => {
        const aiService = makeAiService({
            sendMessage: async () => ({
                success: true,
                response: 'hello world',
                sessionId: 'sess-42',
            }),
        });
        const ctx = makeCtx({
            getCopilotSdkService: () => aiService as any,
        });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPost('/api/agent-providers/copilot/models/query', {
            prompt: 'say hi',
        });
        expect(status).toBe(200);
        const data = body as { success: boolean; provider: string; response: string };
        expect(data.success).toBe(true);
        expect(data.provider).toBe('copilot');
        expect(data.response).toBe('hello world');
    });

    it('returns 400 for missing prompt', async () => {
        const aiService = makeAiService();
        const ctx = makeCtx({
            getCopilotSdkService: () => aiService as any,
        });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPost('/api/agent-providers/copilot/models/query', {});
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('prompt is required');
    });

    it('returns 400 when codex provider is disabled', async () => {
        const ctx = makeCtx({
            runtimeConfigService: makeRuntimeConfigService({ codex: { enabled: false } }),
        });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPost('/api/agent-providers/codex/models/query', {
            prompt: 'test',
        });
        expect(status).toBe(400);
        const data = body as { success: boolean; error: string };
        expect(data.success).toBe(false);
        expect(data.error).toContain('not enabled');
    });

    it('returns 400 when claude provider is disabled', async () => {
        const ctx = makeCtx({
            runtimeConfigService: makeRuntimeConfigService({ claude: { enabled: false } }),
        });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPost('/api/agent-providers/claude/models/query', {
            prompt: 'test',
        });
        expect(status).toBe(400);
        const data = body as { success: boolean; error: string };
        expect(data.success).toBe(false);
        expect(data.error).toContain('not enabled');
    });

    it('returns 503 when SDK service is not available', async () => {
        const ctx = makeCtx({
            getCopilotSdkService: () => undefined as any,
        });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPost('/api/agent-providers/copilot/models/query', {
            prompt: 'hello',
        });
        expect(status).toBe(503);
        const data = body as { success: boolean; error: string };
        expect(data.success).toBe(false);
        expect(data.error).toContain('not available');
    });

    it('returns 400 for invalid provider', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPost('/api/agent-providers/invalid/models/query', {
            prompt: 'test',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid provider');
    });
});
