/**
 * Tests for effort-tier routes on agent-providers.
 *
 * Validates GET/PUT /api/agent-providers/:provider/effort-tiers endpoints
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

function makeModelInfo(
    id: string,
    name: string,
    supportedReasoningEfforts?: string[],
): ModelInfo {
    return {
        id,
        name,
        capabilities: {
            supports: { vision: false, reasoningEffort: (supportedReasoningEfforts?.length ?? 0) > 0 },
            limits: { max_context_window_tokens: 128_000 },
        },
        ...(supportedReasoningEfforts ? { supportedReasoningEfforts } : {}),
    };
}

const CATALOG_WITH_REASONING: ModelInfo[] = [
    makeModelInfo('fast-model', 'Fast Model'),
    makeModelInfo('mid-model', 'Mid Model', ['low', 'medium', 'high']),
    makeModelInfo('opus-model', 'Opus Model', ['medium', 'high']),
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
        sendMessage: async () => ({ success: true, response: 'ok', sessionId: 'sess-1' }),
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
        getCodexAvailability: async () => ({ available: false, error: 'not installed' }),
        getClaudeAvailability: async () => ({ available: false, error: 'not installed' }),
        loadConfigFile: cfgFns.loadConfigFile,
        writeConfigFile: cfgFns.writeConfigFile,
        getConfigFilePath: cfgFns.getConfigFilePath,
        ...overrides,
    } as AgentProvidersRouteContext;
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/agent-providers/:provider/effort-tiers', () => {
    afterEach(async () => {
        await stopServer();
        mockGetAll.mockReset();
    });

    it('returns empty effortTiers for fresh provider', async () => {
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/effort-tiers');
        expect(status).toBe(200);
        const data = body as { provider: string; effortTiers: Record<string, unknown> };
        expect(data.provider).toBe('copilot');
        expect(data.effortTiers).toEqual({});
    });

    it('returns configured effortTiers for copilot', async () => {
        const cfgFns = makeConfigFunctions({
            models: {
                providers: {
                    copilot: {
                        effortTiers: {
                            low: { model: 'fast-model', reasoningEffort: null },
                            medium: { model: 'mid-model', reasoningEffort: 'medium' },
                            high: { model: 'opus-model', reasoningEffort: 'high' },
                        },
                    },
                },
            },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/effort-tiers');
        expect(status).toBe(200);
        const data = body as { provider: string; effortTiers: Record<string, unknown> };
        expect(data.effortTiers).toMatchObject({
            low: { model: 'fast-model', reasoningEffort: null },
            medium: { model: 'mid-model', reasoningEffort: 'medium' },
            high: { model: 'opus-model', reasoningEffort: 'high' },
        });
    });

    it('returns 400 for invalid provider', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/invalid/effort-tiers');
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid provider');
    });

    it('isolates providers — codex tiers not visible on copilot', async () => {
        const cfgFns = makeConfigFunctions({
            models: {
                providers: {
                    codex: { effortTiers: { low: { model: 'gpt-5.5' } } },
                },
            },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiGet('/api/agent-providers/copilot/effort-tiers');
        expect(status).toBe(200);
        expect((body as { effortTiers: Record<string, unknown> }).effortTiers).toEqual({});
    });
});

describe('PUT /api/agent-providers/:provider/effort-tiers — single-tier upsert', () => {
    afterEach(async () => {
        await stopServer();
        mockGetAll.mockReset();
    });

    it('writes a single tier (catalog validation skipped when catalog empty)', async () => {
        mockGetAll.mockReturnValue([]);
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'medium',
            model: 'some-model',
            reasoningEffort: null,
        });
        expect(status).toBe(200);
        const data = body as { provider: string; effortTiers: Record<string, unknown> };
        expect(data.provider).toBe('copilot');
        expect(data.effortTiers).toMatchObject({ medium: { model: 'some-model', reasoningEffort: null } });

        // Written config carries the new tier
        expect(cfgFns.writtenConfig?.models?.providers?.copilot?.effortTiers?.medium).toMatchObject({
            model: 'some-model',
        });
    });

    it('merges new tier into existing tiers', async () => {
        mockGetAll.mockReturnValue([]);
        const cfgFns = makeConfigFunctions({
            models: {
                providers: {
                    copilot: {
                        effortTiers: { low: { model: 'existing-low', reasoningEffort: null } },
                    },
                },
            },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'high',
            model: 'new-high',
            reasoningEffort: 'high',
        });

        const { status, body } = await apiGet('/api/agent-providers/copilot/effort-tiers');
        expect(status).toBe(200);
        const data = body as { effortTiers: Record<string, unknown> };
        expect(data.effortTiers).toMatchObject({
            low: { model: 'existing-low' },
            high: { model: 'new-high', reasoningEffort: 'high' },
        });
    });

    it('returns 400 for invalid tier key', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'ultra',
            model: 'some-model',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid tier');
    });

    it('returns 400 when model is missing', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'low',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('model is required');
    });

    it('returns 400 when model is not in provider catalog', async () => {
        mockGetAll.mockReturnValue(CATALOG_WITH_REASONING);
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'low',
            model: 'nonexistent-model',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('not in the copilot catalog');
    });

    it('returns 400 when reasoningEffort is not supported by model', async () => {
        mockGetAll.mockReturnValue(CATALOG_WITH_REASONING);
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        // fast-model has no supportedReasoningEfforts, so any non-null effort should fail
        // opus-model supports ['medium', 'high'], so 'low' should fail
        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'low',
            model: 'opus-model',
            reasoningEffort: 'low',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('not supported by model');
    });

    it('allows null reasoningEffort (Auto) for any model', async () => {
        mockGetAll.mockReturnValue(CATALOG_WITH_REASONING);
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'high',
            model: 'opus-model',
            reasoningEffort: null,
        });
        expect(status).toBe(200);
    });

    it('accepts valid model + effort in catalog', async () => {
        mockGetAll.mockReturnValue(CATALOG_WITH_REASONING);
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            tier: 'medium',
            model: 'mid-model',
            reasoningEffort: 'medium',
        });
        expect(status).toBe(200);
        const data = body as { effortTiers: Record<string, unknown> };
        expect(data.effortTiers).toMatchObject({ medium: { model: 'mid-model', reasoningEffort: 'medium' } });
    });
});

describe('PUT /api/agent-providers/:provider/effort-tiers — full-map replace', () => {
    afterEach(async () => {
        await stopServer();
        mockGetAll.mockReset();
    });

    it('replaces full tier map', async () => {
        mockGetAll.mockReturnValue([]);
        const cfgFns = makeConfigFunctions({
            models: { providers: { copilot: { effortTiers: { low: { model: 'old-low' } } } } },
        });
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            effortTiers: {
                medium: { model: 'new-mid', reasoningEffort: null },
                high: { model: 'new-high', reasoningEffort: null },
            },
        });
        expect(status).toBe(200);
        const data = body as { effortTiers: Record<string, unknown> };
        // full-map replace: old 'low' tier should be gone
        expect(data.effortTiers).not.toHaveProperty('low');
        expect(data.effortTiers).toMatchObject({
            medium: { model: 'new-mid' },
            high: { model: 'new-high' },
        });
    });

    it('returns 400 when full map contains invalid tier key', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            effortTiers: { ultra: { model: 'some-model' } },
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid tier key');
    });

    it('returns 400 when full map entry is missing model', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            effortTiers: { low: { reasoningEffort: 'high' } },
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('model is required');
    });

    it('returns 400 when model not in catalog (full map)', async () => {
        mockGetAll.mockReturnValue(CATALOG_WITH_REASONING);
        const cfgFns = makeConfigFunctions({});
        const ctx = makeCtx({ ...cfgFns });
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            effortTiers: { medium: { model: 'nonexistent' } },
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('not in the copilot catalog');
    });
});

describe('PUT /api/agent-providers/:provider/effort-tiers — per-provider isolation', () => {
    afterEach(async () => {
        await stopServer();
        mockGetAll.mockReset();
    });

    it('writes to codex without touching copilot tiers', async () => {
        mockGetAll.mockReturnValue([]);
        const codexService = makeAiService({
            listModels: async () => [makeModelInfo('gpt-5.5', 'GPT-5.5')] as unknown as any[],
        });
        const cfgFns = makeConfigFunctions({
            models: { providers: { copilot: { effortTiers: { low: { model: 'copilot-low' } } } } },
        });
        const ctx = makeCtx({
            ...cfgFns,
            getCodexSdkService: () => codexService as unknown as any,
        });
        server = makeServer(ctx);
        await startServer();

        const { status } = await apiPut('/api/agent-providers/codex/effort-tiers', {
            tier: 'high',
            model: 'gpt-5.5',
        });
        expect(status).toBe(200);

        // Copilot tiers unchanged
        const { body } = await apiGet('/api/agent-providers/copilot/effort-tiers');
        expect((body as { effortTiers: Record<string, unknown> }).effortTiers).toMatchObject({
            low: { model: 'copilot-low' },
        });
    });
});

describe('PUT /api/agent-providers/:provider/effort-tiers — bad request', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns 400 when neither tier nor effortTiers is provided', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/copilot/effort-tiers', {
            model: 'something',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('tier');
    });

    it('returns 400 for invalid provider', async () => {
        const ctx = makeCtx();
        server = makeServer(ctx);
        await startServer();

        const { status, body } = await apiPut('/api/agent-providers/bogus/effort-tiers', {
            tier: 'low',
            model: 'x',
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid provider');
    });
});
