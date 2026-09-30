/**
 * Importing a native Copilot CLI session creates an idle CoC chat in the
 * target workspace that holds the rebuilt transcript and is bound to the
 * native session id, so follow-ups resume that session.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { NativeCopilotSessionDetail } from '@plusplusoneplusplus/coc-client';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerNativeCopilotSessionRoutes } from '../../src/server/routes/native-copilot-session-routes';
import type { NativeCopilotSessionService } from '../../src/server/native-copilot-sessions/native-copilot-session-service';
import {
    buildImportedCopilotChatProcess,
    getImportedNativeSessionProcessIds,
    toImportedConversationTurns,
} from '../../src/server/native-copilot-sessions/native-copilot-session-import';
import { sessionMatchesWorkspace } from '../../src/server/native-copilot-sessions/native-copilot-session-service';
import { readActiveProviderSession } from '../../src/server/processes/active-provider-session';
import type {
    NativeCopilotSessionDetailResult,
    NativeSessionWorkspaceScope,
} from '../../src/server/native-copilot-sessions/types';

const SESSION_ID = 'native-abc';

function fixtureSession(overrides: Partial<NativeCopilotSessionDetail> = {}): NativeCopilotSessionDetail {
    return {
        id: SESSION_ID,
        repository: 'someone/elsewhere',
        cwd: path.join(os.tmpdir(), 'somewhere-else'),
        hostType: 'cli',
        branch: 'main',
        summary: 'Fix the flaky login test',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:05:00.000Z',
        turns: [],
        conversation: [
            {
                role: 'user',
                content: 'Please fix the login test',
                timestamp: '2026-09-01T10:00:00.000Z',
                turnIndex: 0,
                timeline: [],
                images: ['data:image/png;base64,AAAA'],
            },
            {
                role: 'assistant',
                content: 'Fixed it.',
                timestamp: '2026-09-01T10:01:00.000Z',
                turnIndex: 1,
                model: 'gpt-5.5',
                thinking: 'Look at the test first',
                toolCalls: [{
                    id: 'tc-1',
                    toolName: 'bash',
                    args: { command: 'npm test' },
                    result: 'ok',
                    status: 'completed',
                    startTime: '2026-09-01T10:00:10.000Z',
                    endTime: '2026-09-01T10:00:20.000Z',
                }],
                timeline: [
                    {
                        type: 'tool-start',
                        timestamp: '2026-09-01T10:00:10.000Z',
                        toolCall: { id: 'tc-1', toolName: 'bash', args: { command: 'npm test' }, status: 'running' },
                    },
                    { type: 'content', timestamp: '2026-09-01T10:00:30.000Z', content: 'Fixed it.' },
                ],
            },
        ],
        ...overrides,
    };
}

class StubService {
    getCalls: Array<{ scope: NativeSessionWorkspaceScope; id: string }> = [];
    constructor(public detail: NativeCopilotSessionDetailResult) {}
    listSessions(): never { throw new Error('not used'); }
    getSession(scope: NativeSessionWorkspaceScope, id: string): NativeCopilotSessionDetailResult {
        this.getCalls.push({ scope, id });
        if (this.detail.available && this.detail.session && this.detail.session.id !== id) {
            return { available: true, session: null };
        }
        return this.detail;
    }
}

describe('native Copilot session import', () => {
    let tmpDir: string;
    let store: SqliteProcessStore;
    let wsRoot: string;
    const servers: Array<{ close: () => Promise<void> }> = [];

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-import-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        wsRoot = path.join(tmpDir, 'repo');
        await store.registerWorkspace({ id: 'ws-1', name: 'Repo 1', rootPath: wsRoot });
        await store.registerWorkspace({ id: 'ws-2', name: 'Repo 2', rootPath: path.join(tmpDir, 'repo2') });
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => server.close()));
        store.close?.();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function start(service: StubService, enabled = true): Promise<string> {
        const routes: Route[] = [];
        registerNativeCopilotSessionRoutes({
            routes,
            store,
            getEnabled: () => enabled,
            service: service as unknown as NativeCopilotSessionService,
            resolveWorkspaceRepository: () => 'owner/repo',
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP address');
        servers.push({
            close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
        });
        return `http://127.0.0.1:${address.port}`;
    }

    async function postImport(baseUrl: string, workspaceId: string, sessionId = SESSION_ID) {
        const res = await fetch(
            `${baseUrl}/api/workspaces/${workspaceId}/native-copilot-sessions/${encodeURIComponent(sessionId)}/import`,
            { method: 'POST' },
        );
        return { status: res.status, body: await res.json() as any };
    }

    it('imports a session whose cwd does not match the workspace into that workspace', async () => {
        const service = new StubService({ available: true, session: fixtureSession() });
        const baseUrl = await start(service);

        const res = await postImport(baseUrl, 'ws-1');
        expect(res.status).toBe(201);
        expect(res.body.created).toBe(true);
        expect(res.body.processId).toMatch(/^queue_/);
        expect(service.getCalls[0].scope).toEqual({ matchAll: true });

        const proc = await store.getProcess(res.body.processId, 'ws-1');
        expect(proc).toBeDefined();
        expect(proc!.type).toBe('chat');
        expect(proc!.status).toBe('completed');
        expect(proc!.workingDirectory).toBe(wsRoot);
        expect(proc!.title).toBe('Fix the flaky login test');
        expect(proc!.metadata).toMatchObject({
            workspaceId: 'ws-1',
            provider: 'copilot',
            model: 'gpt-5.5',
            importedFrom: { provider: 'copilot', nativeSessionId: SESSION_ID },
        });
        expect(proc!.sdkSessionId).toBe(SESSION_ID);
        expect(readActiveProviderSession(proc!)).toMatchObject({ provider: 'copilot', sessionId: SESSION_ID });

        const turns = proc!.conversationTurns!;
        expect(turns).toHaveLength(2);
        expect(turns[0]).toMatchObject({ role: 'user', content: 'Please fix the login test', turnIndex: 0 });
        expect(turns[0].images).toEqual(['data:image/png;base64,AAAA']);
        expect(turns[1]).toMatchObject({ role: 'assistant', turnIndex: 1, model: 'gpt-5.5' });
        expect(turns[1].content).toContain('Look at the test first');
        expect(turns[1].content).toContain('Fixed it.');
        expect(turns[1].toolCalls?.[0]).toMatchObject({ id: 'tc-1', name: 'bash', status: 'completed', result: 'ok' });
        expect(turns[1].timeline.map(item => item.type)).toEqual(['content', 'tool-start', 'content']);

        const history = await store.getAllProcesses({ workspaceId: 'ws-1', status: ['completed'] });
        expect(history.map(p => p.id)).toContain(res.body.processId);
    });

    it('dedupes re-imports per workspace and returns the existing chat', async () => {
        const service = new StubService({ available: true, session: fixtureSession() });
        const baseUrl = await start(service);

        const first = await postImport(baseUrl, 'ws-1');
        const second = await postImport(baseUrl, 'ws-1');
        expect(second.status).toBe(200);
        expect(second.body).toEqual({ processId: first.body.processId, created: false });
        expect(await store.getAllProcesses({ workspaceId: 'ws-1' })).toHaveLength(1);

        // Another workspace gets its own chat for the same native session.
        const other = await postImport(baseUrl, 'ws-2');
        expect(other.status).toBe(201);
        expect(other.body.processId).not.toBe(first.body.processId);
        expect(await store.getAllProcesses({ workspaceId: 'ws-1' })).toHaveLength(1);
    });

    it('creates one chat when imports race', async () => {
        const service = new StubService({ available: true, session: fixtureSession() });
        const baseUrl = await start(service);

        const results = await Promise.all([postImport(baseUrl, 'ws-1'), postImport(baseUrl, 'ws-1')]);
        expect(new Set(results.map(r => r.body.processId)).size).toBe(1);
        expect(await store.getAllProcesses({ workspaceId: 'ws-1' })).toHaveLength(1);
    });

    it('returns 404 when the feature flag is off', async () => {
        const service = new StubService({ available: true, session: fixtureSession() });
        const baseUrl = await start(service, false);

        const res = await postImport(baseUrl, 'ws-1');
        expect(res.status).toBe(404);
        expect(service.getCalls).toHaveLength(0);
        expect(await store.getAllProcesses({ workspaceId: 'ws-1' })).toHaveLength(0);
    });

    it('returns 404 for an unknown workspace or session', async () => {
        const service = new StubService({ available: true, session: fixtureSession() });
        const baseUrl = await start(service);

        expect((await postImport(baseUrl, 'ws-missing')).status).toBe(404);
        expect((await postImport(baseUrl, 'ws-1', 'no-such-session')).status).toBe(404);
    });

    it('returns 503 with the unavailable reason when the store is missing', async () => {
        const service = new StubService({ available: false, reason: 'db-missing' });
        const baseUrl = await start(service);

        const res = await postImport(baseUrl, 'ws-1');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('db-missing');
    });
});

describe('native Copilot session import helpers', () => {
    it('matchAll scope matches any native session', () => {
        expect(sessionMatchesWorkspace({ repository: null, cwd: null }, { matchAll: true })).toBe(true);
        expect(sessionMatchesWorkspace({ repository: 'a/b', cwd: '/x' }, { rootPath: '/y' })).toBe(false);
    });

    it('keeps sequential turn indexes and falls back to prior timestamps', () => {
        const now = new Date('2026-09-30T00:00:00.000Z');
        const turns = toImportedConversationTurns([
            { role: 'user', content: 'hi', timestamp: '2026-09-01T00:00:00.000Z', turnIndex: 4, timeline: [] },
            { role: 'assistant', content: 'yo', timeline: [] },
        ], now);
        expect(turns.map(t => t.turnIndex)).toEqual([0, 1]);
        expect(turns[1].timestamp.toISOString()).toBe('2026-09-01T00:00:00.000Z');
        expect(turns.every(t => t.provider === 'copilot')).toBe(true);
    });

    it('titles an empty-summary session from its first user message', () => {
        const proc = buildImportedCopilotChatProcess({
            workspaceId: 'ws-1',
            session: fixtureSession({ summary: '' }),
            processId: 'queue_fixed',
        });
        expect(proc.id).toBe('queue_fixed');
        expect(proc.title).toBe('Please fix the login test');
    });

    it('maps imported and CoC-run sessions to their chats within one workspace', async () => {
        const store = {
            getAllProcesses: async () => [
                { id: 'p-imported', metadata: { workspaceId: 'ws-1', importedFrom: { nativeSessionId: 's-1' } }, sdkSessionId: 's-1' },
                { id: 'p-coc', metadata: { workspaceId: 'ws-1' }, sdkSessionId: 's-2' },
                { id: 'p-other', metadata: { workspaceId: 'ws-2', importedFrom: { nativeSessionId: 's-3' } } },
            ],
        } as any;
        const map = await getImportedNativeSessionProcessIds(store, 'ws-1');
        expect(Object.fromEntries(map)).toEqual({ 's-1': 'p-imported', 's-2': 'p-coc' });
    });
});
