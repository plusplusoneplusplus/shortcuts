import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { GitOpsStore, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import { registerApiWorkspaceRoutes } from '../../../src/server/routes/api-workspace-routes';
import { prepareTaskForEnqueue } from '../../../src/server/routes/queue-enqueue';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import type { Route } from '../../../src/server/types';
import type { ApiRouteContext } from '../../../src/server/routes/api-shared';

describe('browser mode live config and durable owner-scoped activation', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let server: http.Server;
    let baseUrl: string;
    let enabled: boolean;
    beforeEach(async () => {
        dir = fs.mkdtempSync(path.resolve('.browser-mode-test-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        await store.registerWorkspace({ id: 'ws-browser', name: 'Browser fixture', rootPath: dir });
        await store.addProcess({ id: 'browser-chat', type: 'chat', status: 'completed', startTime: new Date(),
            sdkSessionId: 'browser-session', metadata: { type: 'chat', workspaceId: 'ws-browser', provider: 'copilot', mode: 'ask', keep: 'value' } });
        enabled = false;
        const routes: Route[] = [];
        const ctx: ApiRouteContext = { routes, store, dataDir: dir,
            gitOpsStore: new GitOpsStore({ dataDir: dir }),
            bridge: { executeFollowUp: vi.fn(async () => {}), isSessionAlive: vi.fn(async () => true) },
            getLiveFeatureFlags: () => ({ browserControlEnabled: enabled, excalidrawEnabled: false,
                canvasEnabled: false, kustoEnabled: false, chatStyleSelectorEnabled: false,
                chatProviderSwitchingEnabled: false, defaultChatStyle: 'default' }) };
        registerApiProcessRoutes(ctx);
        registerApiWorkspaceRoutes(ctx);
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
    });
    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const request = (url: string, method = 'GET', body?: unknown) => fetch(baseUrl + url, {
        method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    it('settings registry and queued activation change live, and per-repo disable wins', async () => {
        for (const flag of [false, true, false]) {
            enabled = flag;
            const result = await (await request('/api/workspaces/ws-browser/llm-tools-config')).json();
            expect(result.tools.some((tool: { name: string }) => tool.name === 'browser')).toBe(flag);
            const input: any = { type: 'chat', payload: { kind: 'chat', workspaceId: 'ws-browser',
                mode: 'ask', prompt: '/browser browse', context: { browserMode: true } }, config: {} };
            await prepareTaskForEnqueue(input, { dataDir: dir, browserControlEnabled: () => enabled });
            expect(input.payload.context.browserMode === true).toBe(flag);
        }
        enabled = true;
        writeRepoPreferences(dir, 'ws-browser', { disabledLlmTools: ['browser'] });
        const input: any = { type: 'chat', payload: { kind: 'chat', workspaceId: 'ws-browser', prompt: '/browser browse' }, config: {} };
        await prepareTaskForEnqueue(input, { dataDir: dir, browserControlEnabled: () => enabled });
        expect(input.payload.context?.browserMode).toBeUndefined();
    });
    it('persists follow-up activation, survives disk reload, and clears via metadata patch', async () => {
        enabled = true;
        const result = await request('/api/processes/browser-chat/message?workspace=ws-browser', 'POST', { content: '/browser browse', mode: 'ask' });
        expect(result.status).toBe(202);
        expect((await store.getProcess('browser-chat'))?.metadata?.browserMode).toBe(true);
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        expect((await store.getProcess('browser-chat'))?.metadata?.browserMode).toBe(true);
        // The route owns the original store handle; reopen it before the mutation.
        const routes: Route[] = [];
        registerApiProcessRoutes({ routes, store, dataDir: dir, gitOpsStore: new GitOpsStore({ dataDir: dir }) });
        await new Promise<void>(resolve => server.close(() => resolve()));
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
        expect((await request('/api/processes/browser-chat?workspace=other', 'PATCH', { metadataPatch: { set: { browserMode: false } } })).status).toBe(404);
        expect((await request('/api/processes/browser-chat?workspace=ws-browser', 'PATCH', { metadataPatch: { set: { browserMode: false } } })).status).toBe(200);
        const saved = await store.getProcess('browser-chat');
        expect(saved?.metadata?.browserMode).toBe(false);
        expect(saved?.metadata?.keep).toBe('value');
    });
    it('does not activate when off and rejects invalid metadata', async () => {
        expect((await request('/api/processes/browser-chat/message?workspace=ws-browser', 'POST', { content: '/browser browse', mode: 'ask' })).status).toBe(202);
        expect((await store.getProcess('browser-chat'))?.metadata?.browserMode).toBeUndefined();
        for (const browserMode of [true, 'true']) {
            expect((await request('/api/processes/browser-chat?workspace=ws-browser', 'PATCH', { metadataPatch: { set: { browserMode } } })).status).toBe(400);
        }
    });
});
