/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { parseDashboardChatReference, resolveDashboardChatReference } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/chat-reference';
import { publishDashboardTopology } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { tagRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { repoHashBase } from '../../../../src/server/spa/client/react/layout/routePath';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Route } from '../../../../src/server/types';
import { registerApiProcessRoutes } from '../../../../src/server/routes/api-process-routes';
import { createMockProcessStore } from '../../../server/helpers/mock-process-store';
import { getOrCreateServerIdentity } from '../../../../src/server/servers/server-identity';
import { createWorkspaceDirectory } from '../../../../src/server/servers/workspace-directory';
import { createSendToConversationTool } from '../../../../src/server/llm-tools/send-to-conversation-tool';
import { buildDashboardArtifactReference } from '../../../../src/server/shared/chat-reference';
import { registerTaskRoutes } from '../../../../src/server/tasks/tasks-read-handler';

const reference = { serverIdentity: 'destination', workspaceId: 'same', processId: 'chat' };
const local = { id: 'same', name: 'Local collision' } as WorkspaceInfo;
const rows = (kind: 'ssh' | 'devtunnel' = 'ssh', port = 5000, identity = 'destination', offline = false, alias: string = kind) =>
    tagRemoteWorkspaces({ id: alias, label: `${alias} server`, kind, serverIdentity: identity },
        `http://localhost:${port}`, [{ id: 'same', name: 'Repo' } as WorkspaceInfo], offline);
const resolve = (value = reference, signal = new AbortController().signal) => resolveDashboardChatReference(value, signal);
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function serve(handler: (url: URL, init?: RequestInit) => unknown | Promise<unknown> = url =>
    url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
        : { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } }) {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        json(await handler(new URL(String(input), 'http://localhost:4000'), init)));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
afterEach(() => {
    publishDashboardTopology(null, []);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('owner-qualified artifacts', () => {
    const artifactPath = '/workspace/outputs/result ?#%.md';
    const artifact = { ...reference, artifactPath };
    const metadata = { type: 'file', path: artifactPath, resolvedWorkspaceId: 'same' };
    const fetchArtifact = (preview: unknown = metadata) => serve(url =>
        url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
            : url.pathname.endsWith('/files/preview') ? preview
                : { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } });

    it.each([artifactPath, 'C:\\workspace\\outputs\\result.md', '//host/share/result.md'])(
        'round-trips an exact artifact path %s', filePath => {
            const href = buildDashboardArtifactReference('server/?#%', 'workspace/?#%', 'chat/?#%', filePath);
            expect(parseDashboardChatReference(href)).toEqual({
                serverIdentity: 'server/?#%', workspaceId: 'workspace/?#%', processId: 'chat/?#%', artifactPath: filePath,
            });
        });

    it.each(['../secret.md', '/workspace/../secret.md', '/workspace/./result.md', 'file:///workspace/result.md',
        'https://other/result.md', '~/result.md', '/workspace/\0bad.md', '/workspace/\nbad.md', 'C:relative.md'])(
        'rejects unsafe artifact syntax %j without requests', async filePath => {
            expect(() => buildDashboardArtifactReference('destination', 'same', 'chat', filePath)).toThrow();
            expect(parseDashboardChatReference('#chat-references/destination/same/chat/artifacts/' + encodeURIComponent(filePath))).toBeNull();
            const fetcher = fetchArtifact();
            await expect(resolve({ ...reference, artifactPath: filePath })).rejects.toThrow('unavailable');
            expect(fetcher).not.toHaveBeenCalled();
        });

    it.each(['#chat-references/destination/same/chat/artifacts',
        '#chat-references/destination/same/chat/artifacts/%ZZ',
        '#chat-references/destination/same/chat/artifacts/%2Fresult.md/extra'])(
        'rejects malformed artifact selectors %s', hash => expect(parseDashboardChatReference(hash)).toBeNull());

    it('rejects oversized qualified references instead of truncating into another file', () => {
        expect(() => buildDashboardArtifactReference('destination', 'same', 'chat', '/' + ' '.repeat(700))).toThrow('too long');
    });

    it('resolves on the current owner only, through guarded metadata resolution, before opening the native chat', async () => {
        publishDashboardTopology('viewer', [local, ...rows('ssh', 7000, 'destination', false, 'reconnected')], 'viewer-owner');
        const fetcher = fetchArtifact();
        await expect(resolve(artifact)).resolves.toEqual({
            selectionId: buildRemoteCloneKey('reconnected', 'same'), workspaceId: 'same', processId: 'chat', artifactPath,
            href: `${repoHashBase(buildRemoteCloneKey('reconnected', 'same'))}/chats/chat`,
        });
        expect(fetcher).toHaveBeenCalledTimes(4);
        const [url, init] = fetcher.mock.calls[2];
        expect(new URL(String(url)).pathname).toBe('/api/workspaces/same/files/preview');
        expect(new URL(String(url)).searchParams.get('resolve')).toBe('true');
        expect(new URL(String(url)).searchParams.get('path')).toBe(artifactPath);
        expect(init?.method).toBeUndefined();
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '7000')).toBe(true);
    });

    it.each([{ ...metadata, type: 'directory' }, { ...metadata, resolvedWorkspaceId: 'another-repo' },
        { ...metadata, path: '/different/result.md' }, { ...metadata, path: undefined }])(
        'rejects a mismatched artifact owner or target %j', async preview => {
            publishDashboardTopology('viewer', rows());
            fetchArtifact(preview);
            await expect(resolve(artifact)).rejects.toThrow('unavailable');
        });

    it.each(['abort', 'topology', 'replacement'])('rejects late artifact resolution after %s', async change => {
        publishDashboardTopology('viewer', rows());
        let finish!: (value: unknown) => void;
        let healthReads = 0;
        serve(url => url.pathname.endsWith('/health')
            ? { serverIdentity: ++healthReads === 2 && change === 'replacement' ? 'other-owner' : 'destination' }
            : url.pathname.endsWith('/files/preview') ? new Promise(resolve => { finish = resolve; })
                : { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } });
        const controller = new AbortController();
        const pending = resolve(artifact, controller.signal);
        const outcome = expect(pending).rejects;
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        if (change === 'abort') controller.abort(new Error('cancelled artifact'));
        if (change === 'topology') publishDashboardTopology('viewer', rows('ssh', 7000));
        finish(metadata);
        await outcome.toThrow(change === 'abort' ? 'cancelled artifact' : 'unavailable');
    });

    it('keeps the real authorized preview handler authoritative for files and symlink escapes', async () => {
        const scratch = path.resolve('.test-scratch');
        fs.mkdirSync(scratch, { recursive: true });
        const directory = fs.mkdtempSync(path.join(scratch, 'artifact-guards-'));
        try {
            const root = path.join(directory, 'repo');
            const dataDir = path.join(directory, 'data');
            fs.mkdirSync(root);
            fs.mkdirSync(dataDir);
            const allowedPath = path.join(root, 'result.md');
            const outsidePath = path.join(directory, 'private.md');
            fs.writeFileSync(allowedPath, 'Authorized artifact');
            fs.writeFileSync(outsidePath, 'Must not be read');
            const symlinkPath = path.join(root, 'escape.md');
            // Windows symlinks can require privileges; direct outside-root denial is unconditional.
            let linked = false;
            try { fs.symlinkSync(outsidePath, symlinkPath); linked = true; } catch (error) {
                if (process.platform !== 'win32') throw error;
            }
            const store = createMockProcessStore({ initialWorkspaces: [{ id: 'same', name: 'Repo', rootPath: root }] });
            const routes: Route[] = [];
            registerTaskRoutes(routes, store, dataDir);
            const handler = routes.find(route => route.pattern instanceof RegExp
                && route.pattern.test('/api/workspaces/same/files/preview'))!;
            publishDashboardTopology('viewer', rows());
            serve(async url => {
                if (url.pathname.endsWith('/health')) return { serverIdentity: 'destination' };
                if (!url.pathname.endsWith('/files/preview')) return { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } };
                let body = '';
                let status = 0;
                const response = { headersSent: false, writeHead: (code: number) => { status = code; },
                    end: (value: Buffer | string) => { body = value.toString(); } };
                await handler.handler({ url: url.pathname + url.search } as IncomingMessage,
                    response as unknown as ServerResponse, url.pathname.match(handler.pattern as RegExp)!);
                if (status !== 200) throw new Error('File access denied');
                return JSON.parse(body);
            });
            await expect(resolve({ ...reference, artifactPath: allowedPath })).resolves.toMatchObject({ artifactPath: allowedPath });
            await expect(resolve({ ...reference, artifactPath: outsidePath })).rejects.toThrow('unavailable');
            if (linked) await expect(resolve({ ...reference, artifactPath: symlinkPath })).rejects.toThrow('unavailable');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe('durable chat reference parser', () => {
    it('decodes segments once, preserving encoded separators and reserved characters', () => {
        const ids = ['server/one', 'group-works ?#%', 'chat/a?b#%2F'];
        expect(parseDashboardChatReference('#chat-references/' + ids.map(encodeURIComponent).join('/')))
            .toEqual({ serverIdentity: ids[0], workspaceId: ids[1], processId: ids[2] });
    });
    it.each(['#repos/server/ws/chat', 'chat-references/server/ws/chat', '#chat-references/server/ws',
        '#chat-references/server/ws/chat/extra', '#chat-references//ws/chat', '#chat-references/server/%20/chat',
        '#chat-references/server/%ZZ/chat', '#chat-references/server/ws/chat?alias=other',
        '#chat-references/server/ws/' + 'x'.repeat(513)])('rejects malformed selector %s', hash => {
        expect(parseDashboardChatReference(hash)).toBeNull();
    });
});

describe('application-generated job links through the shared resolver', () => {
    const invocation = { sessionId: 'parent-session', toolCallId: 'delegate', toolName: 'send_to_conversation', arguments: {} };
    const store = { getWorkspaces: async () => [{ id: 'parent' }, { id: 'same' }] } as unknown as ProcessStore;

    async function launch(remote: boolean) {
        const scratch = path.resolve('.test-scratch');
        fs.mkdirSync(scratch, { recursive: true });
        const directory = fs.mkdtempSync(path.join(scratch, 'job-links-'));
        try {
            const identity = getOrCreateServerIdentity(directory);
            // Reopening this installation uses the same identity, independently of ports/workspaces.
            expect(getOrCreateServerIdentity(directory)).toBe(identity);
            const fetchImpl = vi.fn(async (url: string) => json(url.endsWith('/health')
                ? { serverIdentity: identity } : { task: { id: 'child/a ?#%' } }));
            const workspaceDirectory = createWorkspaceDirectory({ store,
                remoteServers: { list: () => [{ id: 'ssh-alias-port-22', kind: 'ssh',
                    effectiveUrl: 'http://localhost:5555', serverIdentity: identity } as never] },
                fetchImpl: fetchImpl as typeof fetch });
            const enqueueChat = vi.fn(async () => 'child/a ?#%');
            const { tool } = createSendToConversationTool({ store, workspaceId: 'parent', enqueueChat,
                runtime: { serverIdentity: remote ? 'invoking-installation' : identity, workspaceDirectory } });
            const result = await tool.handler({ content: 'Authorized work', provider: 'copilot',
                workspaceId: remote ? 'remote:ssh-alias-port-22:same' : 'same' }, invocation);
            if ('error' in result) throw new Error(result.error);
            expect(result.openLink).toBe(`#chat-references/${identity}/same/${encodeURIComponent(result.processId)}`);
            expect(enqueueChat).toHaveBeenCalledTimes(remote ? 0 : 1);
            expect(fetchImpl).toHaveBeenCalledTimes(remote ? 3 : 0);
            return { identity, result };
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    }

    it.each([false, true])('resolves a generated link on a remote viewer (remote dispatch: %s)', async remote => {
        const { identity, result } = await launch(remote);
        const selector = parseDashboardChatReference(result.openLink!)!;
        // The creator's local job is remote from this viewer; a local ID collision cannot win.
        publishDashboardTopology('viewer', [local, ...rows('ssh', 7000, identity, false, 'reconnected-alias')], 'viewer-installation');
        const fetcher = serve(url => url.pathname.endsWith('/health') ? { serverIdentity: identity }
            : { process: { id: result.processId, metadata: { workspaceId: 'same' }, type: 'chat' } });
        await expect(resolve(selector)).resolves.toMatchObject({
            selectionId: buildRemoteCloneKey('reconnected-alias', 'same'), processId: result.processId,
        });
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '7000')).toBe(true);
        expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('workspace')).toBe('same');
    });

    it.each(['offline', 'unknown', 'replaced'] as const)('keeps generated links unavailable for %s owners', async state => {
        const { identity, result } = await launch(false);
        const remotes = rows('ssh', 7000, state === 'replaced' ? 'replacement' : identity, state === 'offline');
        if (state === 'unknown') remotes[0].remote.serverIdentity = undefined;
        publishDashboardTopology('viewer', [local, ...remotes], 'viewer-installation');
        const fetcher = serve();
        await expect(resolve(parseDashboardChatReference(result.openLink!)!)).rejects.toThrow('Referenced chat unavailable');
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe('exact dashboard chat destination verification', () => {
    it.each(['local', 'remote'] as const)('resolves %s ownership from the real process detail serialization', async kind => {
        const store = createMockProcessStore({ initialProcesses: [{
            id: 'chat', type: 'chat', status: 'completed', promptPreview: 'Saved chat',
            startTime: new Date(), metadata: { workspaceId: 'same', type: 'chat' },
            conversationTurns: [], fullPrompt: 'Private prompt', result: 'Private result',
        }] });
        const routes: Route[] = [];
        registerApiProcessRoutes({ routes, store, gitOpsStore: {} as never });
        const detail = routes.find(route => route.method === 'GET' && route.pattern instanceof RegExp
            && route.pattern.test('/api/processes/chat'))!;
        const identity = kind === 'local' ? 'local-server' : 'destination';
        publishDashboardTopology('owner', [local, ...rows()], 'local-server');
        const fetcher = serve(async url => {
            if (url.pathname.endsWith('/health')) return { serverIdentity: identity };
            let body = '';
            const response = { headersSent: false, writeHead: vi.fn(), end: (value: Buffer) => { body = value.toString(); } };
            await detail.handler({ url: url.pathname + url.search } as IncomingMessage,
                response as unknown as ServerResponse, url.pathname.match(detail.pattern as RegExp)!);
            expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const payload = JSON.parse(body);
            expect(payload).toMatchObject({ process: { id: 'chat', metadata: { workspaceId: 'same' } }, children: [], total: 0 });
            expect(payload.process).not.toHaveProperty('workspaceId');
            expect(payload.process).not.toHaveProperty('conversationTurns');
            expect(payload.process).not.toHaveProperty('fullPrompt');
            expect(payload.process).not.toHaveProperty('result');
            return payload;
        });
        await expect(resolve({ ...reference, serverIdentity: identity })).resolves.toMatchObject({
            selectionId: kind === 'local' ? 'same' : buildRemoteCloneKey('ssh', 'same'), processId: 'chat',
        });
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(store.getProcess).toHaveBeenCalledWith('chat', 'same');
    });

    it.each(['ssh', 'devtunnel'] as const)('uses the current %s endpoint and alias after offline reconnect and a port change', async kind => {
        const fetcher = serve();
        publishDashboardTopology('owner', [local, ...rows(kind, 5000, 'destination', true)], 'local-server');
        await expect(resolve()).rejects.toThrow('Referenced chat unavailable');
        expect(fetcher).not.toHaveBeenCalled();
        publishDashboardTopology('owner', [local, ...rows(kind, 7000, 'destination', false, 'new-alias')], 'local-server');
        const selectionId = buildRemoteCloneKey('new-alias', 'same');
        await expect(resolve()).resolves.toEqual({ selectionId, workspaceId: 'same', processId: 'chat',
            href: `${repoHashBase(selectionId)}/chats/chat` });
        expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).port)).toEqual(['7000', '7000', '7000']);
        const [url, init] = fetcher.mock.calls[1];
        expect(new URL(String(url)).searchParams.get('workspace')).toBe('same');
        expect(new URL(String(url)).searchParams.get('exclude')).toContain('conversation');
        expect(init?.method).toBeUndefined();
        expect(fetcher.mock.calls.every(([, options]) => !options?.body)).toBe(true);
    });

    it('prefers an online alias over an offline alias without probing a same-id different server', async () => {
        publishDashboardTopology('owner', [local, ...rows('ssh', 5000, 'destination', true, 'aaa'),
            ...rows('devtunnel', 7000, 'destination', false, 'bbb'), ...rows('ssh', 8000, 'foreign', false, 'ccc')], 'local-server');
        const fetcher = serve();
        expect((await resolve()).selectionId).toBe(buildRemoteCloneKey('bbb', 'same'));
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '7000')).toBe(true);
    });

    it('resolves a page-origin chat using only observed page-origin identity', async () => {
        publishDashboardTopology('owner', [local, ...rows()], 'local-server');
        const fetcher = serve(url => url.pathname.endsWith('/health') ? { serverIdentity: 'local-server' }
            : { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } });
        await expect(resolve({ ...reference, serverIdentity: 'local-server' })).resolves.toMatchObject({
            selectionId: 'same', href: '#repos/same/chats/chat',
        });
        expect(fetcher.mock.calls.every(([url]) => !String(url).includes(':5000'))).toBe(true);
    });

    it.each(['unknown', 'removed', 'offline', 'replaced', 'endpoint'])('fails closed for %s destinations', async state => {
        const remotes = state === 'removed' ? [] : rows('ssh', 5000, state === 'replaced' ? 'replacement' : 'destination', state === 'offline');
        if (state === 'unknown') remotes[0].remote.serverIdentity = undefined;
        if (state === 'endpoint') remotes[0].remote.baseUrl = '';
        publishDashboardTopology('owner', [local, ...remotes], 'local-server');
        const fetcher = serve();
        await expect(resolve()).rejects.toThrow('Referenced chat unavailable');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([{ id: 'different' }, { metadata: { workspaceId: 'different' } },
        { metadata: undefined }, { metadata: {} }, { metadata: { workspaceId: '' } },
        { workspaceId: 'same', metadata: undefined },
        { workspaceId: 'same', metadata: { workspaceId: 'different' } },
        { type: 'run-script' }, { id: 'queue_chat' }])(
        'rejects process identity mismatch %j without local or queue alias fallback', async patch => {
            publishDashboardTopology('owner', [local, ...rows()], 'local-server');
            const fetcher = serve(url => url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
                : { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat', ...patch } });
            await expect(resolve()).rejects.toThrow('Referenced chat unavailable');
            expect(fetcher).toHaveBeenCalledTimes(2);
        });

    it.each(['before', 'after', 'missing'])('rejects %s server ownership mismatch', async timing => {
        publishDashboardTopology('owner', rows());
        let healthReads = 0;
        const fetcher = serve(url => {
            if (!url.pathname.endsWith('/health')) return { process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } };
            healthReads++;
            return timing === 'missing' ? {} : { serverIdentity: timing === 'after' && healthReads === 1 ? 'destination' : 'other' };
        });
        await expect(resolve()).rejects.toThrow('Referenced chat unavailable');
        expect(fetcher).toHaveBeenCalledTimes(timing === 'after' ? 3 : 1);
    });

    it.each(['health', 'process'])('hides transport failures during %s reads', async failure => {
        publishDashboardTopology('owner', rows());
        serve(url => {
            if (failure === 'health' || !url.pathname.endsWith('/health')) throw new Error('secret transport credential');
            return { serverIdentity: 'destination' };
        });
        await expect(resolve()).rejects.toThrow(/^Referenced chat unavailable\. Reconnect its server and try again\.$/);
    });

    it.each(['port', 'identity', 'removed', 'abort'])('suppresses late process reads after %s changes, even if fetch ignores abort', async change => {
        publishDashboardTopology('owner', rows());
        let finish!: (value: unknown) => void;
        const fetcher = serve(url => url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
            : new Promise(resolve => { finish = resolve; }));
        const controller = new AbortController();
        const pending = resolve(reference, controller.signal);
        const outcome = expect(pending).rejects;
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        if (change === 'abort') controller.abort(new Error('caller aborted'));
        else publishDashboardTopology('owner', change === 'removed' ? []
            : rows('ssh', change === 'port' ? 7000 : 5000, change === 'identity' ? 'replacement' : 'destination'));
        finish({ process: { id: 'chat', metadata: { workspaceId: 'same' }, type: 'chat' } });
        await outcome.toThrow(change === 'abort' ? 'caller aborted' : 'Referenced chat unavailable');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('snapshots selectors and encodes the exact selected process in the resulting route', async () => {
        const processId = 'chat/a ?#%';
        publishDashboardTopology('owner', rows());
        const input = { ...reference, processId };
        serve(url => {
            input.processId = 'different';
            return url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
                : { process: { id: processId, metadata: { workspaceId: 'same' }, type: 'chat' } };
        });
        const result = await resolve(input);
        expect(result.processId).toBe(processId);
        expect(result.href).toBe(`${repoHashBase(buildRemoteCloneKey('ssh', 'same'))}/chats/${encodeURIComponent(processId)}`);
    });

    it('preserves an already-aborted reason without making requests', async () => {
        publishDashboardTopology('owner', rows());
        const fetcher = serve();
        const controller = new AbortController();
        const reason = new Error('cancelled');
        controller.abort(reason);
        await expect(resolve(reference, controller.signal)).rejects.toBe(reason);
        expect(fetcher).not.toHaveBeenCalled();
    });
});
