import * as http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerNativeCliSessionRoutes } from '../../src/server/routes/native-cli-session-routes';
import { NATIVE_CLI_PROVIDER_IDS } from '../../src/server/native-copilot-sessions/types';
import type {
    NativeCliSessionDetailResult,
    NativeCliSessionListOptions,
    NativeCliSessionListResult,
    NativeCliSessionProviderId,
    NativeCliSessionSearchStrategy,
    NativeSessionProvider,
    NativeSessionWorkspaceScope,
} from '../../src/server/native-copilot-sessions/types';

class StubProvider implements NativeSessionProvider {
    readonly label: string;
    readonly storePath: string;
    searchStrategy: NativeCliSessionSearchStrategy = 'on-demand-scan';
    listCalls: Array<{ scope: NativeSessionWorkspaceScope; options: NativeCliSessionListOptions }> = [];
    getCalls: Array<{ scope: NativeSessionWorkspaceScope; id: string }> = [];

    constructor(
        readonly provider: NativeCliSessionProviderId,
        private readonly listResult: NativeCliSessionListResult & { limit: number; offset: number },
        private readonly detailResult: NativeCliSessionDetailResult = { available: true, session: null },
    ) {
        this.label = provider;
        this.storePath = `/store/${provider}`;
    }

    listSessions(scope: NativeSessionWorkspaceScope, options: NativeCliSessionListOptions = {}): NativeCliSessionListResult & { limit: number; offset: number } {
        this.listCalls.push({ scope, options });
        return this.listResult;
    }

    getSession(scope: NativeSessionWorkspaceScope, id: string): NativeCliSessionDetailResult {
        this.getCalls.push({ scope, id });
        return this.detailResult;
    }
}

function makeStore(workspace: WorkspaceInfo, sdkSessionIds = new Set<string>()): ProcessStore {
    return {
        getWorkspaces: async () => [workspace],
        getSdkSessionIds: () => sdkSessionIds,
    } as unknown as ProcessStore;
}

async function startRouteServer(options: {
    enabled: boolean;
    provider: StubProvider;
    store?: ProcessStore;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const routes: Route[] = [];
    registerNativeCliSessionRoutes({
        routes,
        store: options.store ?? makeStore({ id: 'ws-1', name: 'Workspace', rootPath: '/repo' }),
        getEnabled: () => options.enabled,
        providers: new Map([[options.provider.provider, options.provider]]),
        resolveWorkspaceRepository: () => 'owner/repo',
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address');
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
    };
}

async function getJson(baseUrl: string, path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: await res.json() };
}

describe('native CLI session routes', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => server.close()));
    });

    it('returns feature-disabled payloads without touching providers when disabled', async () => {
        const provider = new StubProvider('codex', { available: true, items: [], total: 0, searchIndexAvailable: false, deduplicatedCount: 0, backgroundJobCount: 0, limit: 25, offset: 5 });
        const server = await startRouteServer({ enabled: false, provider });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=codex&limit=25&offset=5');
        expect(list.status).toBe(200);
        expect(list.body).toMatchObject({ enabled: false, reason: 'feature-disabled', items: [], total: 0, limit: 25, offset: 5 });

        const detail = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions/codex-1?provider=codex');
        expect(detail.status).toBe(200);
        expect(detail.body).toMatchObject({ enabled: false, reason: 'feature-disabled' });
        expect(provider.listCalls).toHaveLength(0);
        expect(provider.getCalls).toHaveLength(0);
    });

    it('passes provider, workspace scope, filters, pagination, and dedup ids to the provider', async () => {
        const provider = new StubProvider('codex', {
            available: true,
            items: [{
                id: 'codex-1',
                provider: 'codex',
                storePath: '/store/codex',
                repository: null,
                cwd: '/repo',
                hostType: 'codex',
                branch: 'main',
                summaryPreview: 'hello',
                createdAt: '2026-06-13T00:00:00.000Z',
                updatedAt: '2026-06-13T00:00:01.000Z',
                turnCount: 1,
                matchSnippets: [],
                searchIndexAvailable: false,
            }],
            total: 1,
            searchIndexAvailable: false,
            deduplicatedCount: 1,
            backgroundJobCount: 0,
            limit: 10,
            offset: 2,
        });
        const server = await startRouteServer({
            enabled: true,
            provider,
            store: makeStore({ id: 'ws-1', name: 'Workspace', rootPath: '/repo' }, new Set(['tracked'])),
        });
        servers.push(server);

        const res = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=codex&q=billing&sessionId=codex&branch=main&from=2026-06-01T00%3A00%3A00.000Z&to=2026-06-14T00%3A00%3A00.000Z&limit=10&offset=2');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            enabled: true,
            available: true,
            provider: 'codex',
            total: 1,
            deduplicatedCount: 1,
            searchIndexAvailable: false,
            limit: 10,
            offset: 2,
        });
        expect(res.body.items[0].id).toBe('codex-1');
        expect(provider.listCalls).toHaveLength(1);
        expect(provider.listCalls[0].scope).toEqual({ rootPath: '/repo', repository: 'owner/repo' });
        expect(provider.listCalls[0].options).toMatchObject({
            provider: 'codex',
            q: 'billing',
            sessionId: 'codex',
            branch: 'main',
            from: '2026-06-01T00:00:00.000Z',
            to: '2026-06-14T00:00:00.000Z',
            limit: 10,
            offset: 2,
        });
        expect(provider.listCalls[0].options.excludeSessionIds?.has('tracked')).toBe(true);
    });

    it('serves detail responses and returns 404 for missing sessions', async () => {
        const detailProvider = new StubProvider(
            'claude',
            { available: true, items: [], total: 0, searchIndexAvailable: false, deduplicatedCount: 0, backgroundJobCount: 0, limit: 50, offset: 0 },
            {
                available: true,
                session: {
                    id: 'claude-1',
                    provider: 'claude',
                    storePath: '/store/claude',
                    repository: null,
                    cwd: '/repo',
                    hostType: 'claude',
                    branch: null,
                    summary: 'summary',
                    createdAt: null,
                    updatedAt: null,
                    turns: [],
                    conversation: [{ role: 'user', content: 'hello', timeline: [] }],
                    searchIndexAvailable: false,
                },
            },
        );
        const detailServer = await startRouteServer({ enabled: true, provider: detailProvider });
        servers.push(detailServer);
        const ok = await getJson(detailServer.baseUrl, '/api/workspaces/ws-1/native-cli-sessions/claude-1?provider=claude');
        expect(ok.status).toBe(200);
        expect(ok.body.session).toMatchObject({ id: 'claude-1', provider: 'claude', storePath: '/store/claude' });
        expect(detailProvider.getCalls[0]).toEqual({ scope: { rootPath: '/repo', repository: 'owner/repo' }, id: 'claude-1' });

        const missingProvider = new StubProvider(
            'claude',
            { available: true, items: [], total: 0, searchIndexAvailable: false, deduplicatedCount: 0, backgroundJobCount: 0, limit: 50, offset: 0 },
            { available: true, session: null },
        );
        const missingServer = await startRouteServer({ enabled: true, provider: missingProvider });
        servers.push(missingServer);
        const missing = await getJson(missingServer.baseUrl, '/api/workspaces/ws-1/native-cli-sessions/missing?provider=claude');
        expect(missing.status).toBe(404);
    });

    it('returns typed unavailable and invalid-provider responses', async () => {
        const provider = new StubProvider('codex', { available: false, reason: 'store-missing', limit: 50, offset: 0 });
        const server = await startRouteServer({ enabled: true, provider });
        servers.push(server);

        const unavailable = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=codex');
        expect(unavailable.status).toBe(200);
        expect(unavailable.body).toMatchObject({
            enabled: true,
            available: false,
            reason: 'store-missing',
            items: [],
            total: 0,
            provider: 'codex',
        });

        const invalid = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=unknown');
        expect(invalid.status).toBe(400);
        expect(invalid.body.error).toContain('provider must be one of');
    });

    it('rejects a staged provider with its descriptor note rather than a wiring error', async () => {
        // Regression: `opencode` was accepted by the route parser but had no
        // registered provider, so selecting it surfaced an internal
        // "not registered" error. It is now gated by the shared registry.
        const provider = new StubProvider('codex', { available: true, items: [], total: 0, searchIndexAvailable: false, deduplicatedCount: 0, backgroundJobCount: 0, limit: 50, offset: 0 });
        const server = await startRouteServer({ enabled: true, provider });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=opencode');
        expect(list.status).toBe(400);
        expect(list.body.error).toContain('OpenCode');
        expect(list.body.error).not.toContain('not registered');

        const detail = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions/some-id?provider=opencode');
        expect(detail.status).toBe(400);
        expect(detail.body.error).toContain('OpenCode');
        expect(provider.listCalls).toHaveLength(0);
        expect(provider.getCalls).toHaveLength(0);
    });

    it('lists every known provider id in the invalid-provider message', async () => {
        const provider = new StubProvider('codex', { available: true, items: [], total: 0, searchIndexAvailable: false, deduplicatedCount: 0, backgroundJobCount: 0, limit: 50, offset: 0 });
        const server = await startRouteServer({ enabled: true, provider });
        servers.push(server);

        const res = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=gemini');
        expect(res.status).toBe(400);
        for (const id of NATIVE_CLI_PROVIDER_IDS) {
            expect(res.body.error).toContain(id);
        }
    });

    it('reports an available provider that is not registered as a wiring error', async () => {
        const routes: Route[] = [];
        registerNativeCliSessionRoutes({
            routes,
            store: makeStore({ id: 'ws-1', name: 'Workspace', rootPath: '/repo' }),
            getEnabled: () => true,
            providers: new Map(),
            resolveWorkspaceRepository: () => 'owner/repo',
        });
        const httpServer = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
        const address = httpServer.address();
        if (!address || typeof address === 'string') { throw new Error('Expected TCP address'); }
        servers.push({ close: () => new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve())) });

        const res = await getJson(`http://127.0.0.1:${address.port}`, '/api/workspaces/ws-1/native-cli-sessions?provider=codex');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not registered');
    });

    it('reports the provider search strategy on list and detail responses', async () => {
        const provider = new StubProvider('copilot', { available: true, items: [], total: 0, searchIndexAvailable: true, deduplicatedCount: 0, backgroundJobCount: 0, limit: 50, offset: 0 });
        provider.searchStrategy = 'native-index';
        const server = await startRouteServer({ enabled: true, provider });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=copilot');
        expect(list.body).toMatchObject({ available: true, provider: 'copilot', searchStrategy: 'native-index' });

        const detail = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions/x?provider=copilot');
        expect(detail.status).toBe(404);
    });

    it('reports the search strategy alongside an unavailable store', async () => {
        const provider = new StubProvider('codex', { available: false, reason: 'store-invalid', limit: 50, offset: 0 });
        const server = await startRouteServer({ enabled: true, provider });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions?provider=codex');
        expect(list.body).toMatchObject({
            available: false,
            reason: 'store-invalid',
            provider: 'codex',
            searchStrategy: 'on-demand-scan',
        });
    });

    it('defaults to the copilot provider when none is supplied', async () => {
        const provider = new StubProvider('copilot', { available: true, items: [], total: 0, searchIndexAvailable: true, deduplicatedCount: 0, backgroundJobCount: 0, limit: 50, offset: 0 });
        provider.searchStrategy = 'native-index';
        const server = await startRouteServer({ enabled: true, provider });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-cli-sessions');
        expect(list.status).toBe(200);
        expect(list.body.provider).toBe('copilot');
        expect(provider.listCalls).toHaveLength(1);
    });
});
