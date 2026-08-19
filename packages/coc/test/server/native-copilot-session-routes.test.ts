/**
 * The legacy `/native-copilot-sessions` routes are compatibility aliases kept
 * for bookmarked links. They now share query parsing, workspace scope building,
 * and the disabled/unavailable envelopes with the unified CLI session routes,
 * so these tests pin the alias behaviour that shared plumbing must preserve.
 */

import * as http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerNativeCopilotSessionRoutes } from '../../src/server/routes/native-copilot-session-routes';
import type { NativeCopilotSessionService } from '../../src/server/native-copilot-sessions/native-copilot-session-service';
import type {
    NativeCopilotSessionDetailResult,
    NativeCopilotSessionListOptions,
    NativeCopilotSessionListResult,
    NativeSessionWorkspaceScope,
} from '../../src/server/native-copilot-sessions/types';

type ListResult = NativeCopilotSessionListResult & { limit: number; offset: number };

class StubService {
    listCalls: Array<{ scope: NativeSessionWorkspaceScope; options: NativeCopilotSessionListOptions }> = [];
    getCalls: Array<{ scope: NativeSessionWorkspaceScope; id: string }> = [];

    constructor(
        private readonly listResult: ListResult,
        private readonly detailResult: NativeCopilotSessionDetailResult = { available: true, session: null },
    ) {}

    listSessions(scope: NativeSessionWorkspaceScope, options: NativeCopilotSessionListOptions = {}): ListResult {
        this.listCalls.push({ scope, options });
        return this.listResult;
    }

    getSession(scope: NativeSessionWorkspaceScope, id: string): NativeCopilotSessionDetailResult {
        this.getCalls.push({ scope, id });
        return this.detailResult;
    }
}

function emptyList(limit = 50, offset = 0): ListResult {
    return {
        available: true,
        items: [],
        total: 0,
        searchIndexAvailable: true,
        deduplicatedCount: 0,
        backgroundJobCount: 0,
        limit,
        offset,
    };
}

function makeStore(workspace: WorkspaceInfo, sdkSessionIds = new Set<string>()): ProcessStore {
    return {
        getWorkspaces: async () => [workspace],
        getSdkSessionIds: () => sdkSessionIds,
    } as unknown as ProcessStore;
}

async function startRouteServer(options: {
    enabled: boolean;
    service: StubService;
    store?: ProcessStore;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const routes: Route[] = [];
    registerNativeCopilotSessionRoutes({
        routes,
        store: options.store ?? makeStore({ id: 'ws-1', name: 'Workspace', rootPath: '/repo' }),
        getEnabled: () => options.enabled,
        service: options.service as unknown as NativeCopilotSessionService,
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

describe('legacy native Copilot session routes', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => server.close()));
    });

    it('echoes the requested pagination window in the feature-disabled payload', async () => {
        const service = new StubService(emptyList());
        const server = await startRouteServer({ enabled: false, service });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions?limit=25&offset=5');
        expect(list.status).toBe(200);
        expect(list.body).toMatchObject({
            enabled: false,
            reason: 'feature-disabled',
            items: [],
            total: 0,
            limit: 25,
            offset: 5,
        });

        const detail = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions/session-1');
        expect(detail.body).toMatchObject({ enabled: false, reason: 'feature-disabled' });
        expect(service.listCalls).toHaveLength(0);
        expect(service.getCalls).toHaveLength(0);
    });

    it('falls back to the default pagination window when none is supplied', async () => {
        const service = new StubService(emptyList());
        const server = await startRouteServer({ enabled: false, service });
        servers.push(server);

        const list = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions');
        expect(list.body.limit).toBe(50);
        expect(list.body.offset).toBe(0);
    });

    it('forwards filters, pagination, workspace scope, and dedup ids to the service', async () => {
        const service = new StubService(emptyList(10, 2));
        const server = await startRouteServer({
            enabled: true,
            service,
            store: makeStore({ id: 'ws-1', name: 'Workspace', rootPath: '/repo' }, new Set(['tracked'])),
        });
        servers.push(server);

        const res = await getJson(
            server.baseUrl,
            '/api/workspaces/ws-1/native-copilot-sessions?q=billing&sessionId=abc&branch=main'
            + '&from=2026-06-01T00%3A00%3A00.000Z&to=2026-06-14T00%3A00%3A00.000Z&limit=10&offset=2',
        );
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ enabled: true, available: true, limit: 10, offset: 2 });
        expect(service.listCalls[0].scope).toEqual({ rootPath: '/repo', repository: 'owner/repo' });
        expect(service.listCalls[0].options).toMatchObject({
            q: 'billing',
            sessionId: 'abc',
            branch: 'main',
            from: '2026-06-01T00:00:00.000Z',
            to: '2026-06-14T00:00:00.000Z',
            limit: 10,
            offset: 2,
        });
        expect(service.listCalls[0].options.excludeSessionIds?.has('tracked')).toBe(true);
    });

    it('ignores blank filter values instead of forwarding empty strings', async () => {
        const service = new StubService(emptyList());
        const server = await startRouteServer({ enabled: true, service });
        servers.push(server);

        await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions?q=%20&branch=&limit=abc');
        expect(service.listCalls[0].options.q).toBeUndefined();
        expect(service.listCalls[0].options.branch).toBeUndefined();
        expect(service.listCalls[0].options.limit).toBeUndefined();
    });

    it('returns an unavailable envelope without provider fields', async () => {
        const service = new StubService({ available: false, reason: 'db-missing', limit: 50, offset: 0 });
        const server = await startRouteServer({ enabled: true, service });
        servers.push(server);

        const res = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            enabled: true,
            available: false,
            reason: 'db-missing',
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
        });
        // The legacy alias is Copilot-only, so it never advertises a provider.
        expect(res.body.provider).toBeUndefined();
    });

    it('serves a session detail and 404s a missing one', async () => {
        const service = new StubService(emptyList(), {
            available: true,
            session: {
                id: 'session-1',
                repository: null,
                cwd: '/repo',
                hostType: 'copilot',
                branch: 'main',
                summary: 'summary',
                createdAt: null,
                updatedAt: null,
                turns: [],
                conversation: [{ role: 'user', content: 'hello', timeline: [] }],
            },
        });
        const server = await startRouteServer({ enabled: true, service });
        servers.push(server);

        const ok = await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions/session-1');
        expect(ok.status).toBe(200);
        expect(ok.body.session).toMatchObject({ id: 'session-1' });
        expect(service.getCalls[0]).toEqual({ scope: { rootPath: '/repo', repository: 'owner/repo' }, id: 'session-1' });

        const missingService = new StubService(emptyList(), { available: true, session: null });
        const missingServer = await startRouteServer({ enabled: true, service: missingService });
        servers.push(missingServer);
        const missing = await getJson(missingServer.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions/nope');
        expect(missing.status).toBe(404);
    });

    it('decodes a URL-encoded session id', async () => {
        const service = new StubService(emptyList(), { available: true, session: null });
        const server = await startRouteServer({ enabled: true, service });
        servers.push(server);

        await getJson(server.baseUrl, '/api/workspaces/ws-1/native-copilot-sessions/session%2Fwith%20space');
        expect(service.getCalls[0].id).toBe('session/with space');
    });
});
