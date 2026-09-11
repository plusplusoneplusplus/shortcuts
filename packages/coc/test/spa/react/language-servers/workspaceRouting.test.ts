/**
 * AC-04: every language operation reaches the host that owns the file.
 *
 * The interesting case is the one a repo group creates all the time — the same
 * relative path open in two workspaces at once, one of them a remote clone.
 * Nothing in the wire protocol names a host, so what keeps the two apart is the
 * client cache being keyed on the workspace, the socket URL being resolved
 * through the clone registry, and every document URI carrying its own
 * workspace id. This suite runs the real transport client and the real document
 * store over faked sockets and asserts that a buffer, an answer or a diagnostic
 * belonging to one owner never surfaces under the other.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    LanguageServerClient,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';
import { LanguageDocumentStore } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { FakeSocket } from './fakeLanguageTransport';

const LOCAL = 'ws-local';
const REMOTE = 'ws-remote';
const REMOTE_HOST = 'http://10.0.0.5:4100';
/** The same relative path in both repos — the whole point of the exercise. */
const PATH = 'src/index.ts';

interface Owner {
    workspaceId: string;
    client: LanguageServerClient;
    store: LanguageDocumentStore;
    socket(): FakeSocket;
}

function makeOwner(workspaceId: string): Owner {
    const client = new LanguageServerClient({
        workspaceId,
        editingSessionId: 'session-a',
        createSocket: (url: string) => new FakeSocket(url),
        attachTimeoutMs: 50,
    });
    return {
        workspaceId,
        client,
        store: new LanguageDocumentStore({ workspaceId, client }),
        socket: () => socketFor(workspaceId),
    };
}

/** The socket this workspace's client opened, found by its upgrade URL. */
function socketFor(workspaceId: string): FakeSocket {
    const socket = FakeSocket.instances.find(
        (candidate) => candidate.url.includes(`workspaceId=${encodeURIComponent(workspaceId)}`),
    );
    if (!socket) {
        throw new Error(`No socket for ${workspaceId}`);
    }
    return socket;
}

/** Answer the pending attach on this owner's socket the way the host would. */
function completeAttach(owner: Owner, overrides: Record<string, unknown> = {}): void {
    const socket = owner.socket();
    const attach = socket.sentOfType('lsp-attach').at(-1);
    socket.emit({
        type: 'lsp-attached',
        requestId: attach?.requestId,
        attachmentId: `att-${owner.workspaceId}`,
        sessionKey: `${owner.workspaceId}::session-a::typescript::/repo`,
        documentUri: `coc-file://${owner.workspaceId}/${PATH}`,
        languageId: 'typescript',
        definitionId: 'typescript',
        displayName: 'TypeScript',
        state: {
            status: 'ready',
            definitionId: 'typescript',
            displayName: 'TypeScript',
            capabilities: { textDocumentSync: 1 },
            generation: 1,
        },
        ...overrides,
    });
}

function lastNotification(socket: FakeSocket, method: string): Record<string, unknown> | undefined {
    return [...socket.sentOfType('lsp-notify')]
        .reverse()
        .find((message) => message.method === method)?.params as Record<string, unknown> | undefined;
}

describe('language routing across workspaces and hosts (AC-04)', () => {
    let local: Owner;
    let remote: Owner;

    beforeEach(() => {
        FakeSocket.instances = [];
        resetCloneRegistryForTests();
        // Only the remote workspace is in the registry; a local id resolves to
        // this origin, which is exactly how the app behaves.
        registerCloneBaseUrls([{ workspaceId: REMOTE, baseUrl: REMOTE_HOST }]);
        local = makeOwner(LOCAL);
        remote = makeOwner(REMOTE);
    });

    afterEach(() => {
        local.store.dispose();
        remote.store.dispose();
        local.client.dispose();
        remote.client.dispose();
        resetCloneRegistryForTests();
    });

    it('opens one socket per workspace, each pointed at that workspace’s host', () => {
        local.store.open({ path: PATH, text: 'export const a = 1;' });
        remote.store.open({ path: PATH, text: 'export const a = 1;' });

        expect(FakeSocket.instances).toHaveLength(2);
        expect(new URL(local.socket().url).host).toBe(window.location.host);
        expect(new URL(remote.socket().url).host).toBe('10.0.0.5:4100');
        expect(remote.socket().url.startsWith('ws://')).toBe(true);
    });

    it('routes a concrete remote clone when its workspace id is ambiguous across hosts', () => {
        const workspaceId = 'ws-shared';
        const ownerKey = buildRemoteCloneKey('server-b', workspaceId);
        registerCloneBaseUrls([
            {
                workspaceId,
                serverId: 'server-a',
                baseUrl: 'http://10.0.0.6:4200',
            },
            {
                workspaceId,
                serverId: 'server-b',
                baseUrl: 'http://10.0.0.7:4300',
            },
        ]);
        const client = new LanguageServerClient({
            workspaceId,
            routingRef: ownerKey,
            editingSessionId: 'session-owner',
            createSocket: (url: string) => new FakeSocket(url),
        });

        client.attach(PATH);

        expect(FakeSocket.instances.at(-1)?.url)
            .toBe('ws://10.0.0.7:4300/ws/language-server?workspaceId=ws-shared&editingSessionId=session-owner');
        client.dispose();
    });

    it('never falls through locally while a concrete remote route appears or changes', () => {
        const workspaceId = 'ws-late-remote';
        const ownerKey = buildRemoteCloneKey('server-owner', workspaceId);
        const client = new LanguageServerClient({
            workspaceId,
            routingRef: ownerKey,
            editingSessionId: 'session-route-refresh',
            createSocket: (url: string) => new FakeSocket(url),
        });
        const attachment = client.attach(PATH);

        expect(FakeSocket.instances).toHaveLength(0);
        expect(attachment.getUnavailable()?.reason).toBe('remote-route-unavailable');

        registerCloneBaseUrls([{
            workspaceId,
            serverId: 'server-owner',
            baseUrl: 'http://10.0.0.8:4400',
        }]);
        expect(FakeSocket.instances.map(socket => new URL(socket.url).host)).toEqual(['10.0.0.8:4400']);

        const firstRemoteSocket = FakeSocket.instances[0];
        registerCloneBaseUrls([{
            workspaceId,
            serverId: 'server-owner',
            baseUrl: 'http://10.0.0.9:4500',
        }]);

        expect(firstRemoteSocket.closed?.reason).toBe('clone route changed');
        expect(FakeSocket.instances.map(socket => new URL(socket.url).host))
            .toEqual(['10.0.0.8:4400', '10.0.0.9:4500']);
        expect(FakeSocket.instances.some(socket => new URL(socket.url).host === window.location.host)).toBe(false);
        client.dispose();
    });

    it('opens the document on each host under that host’s own workspace id', () => {
        local.store.open({ path: PATH, text: 'export const a = 1;' });
        remote.store.open({ path: PATH, text: 'export const b = 2;' });
        local.socket().open();
        remote.socket().open();
        completeAttach(local);
        completeAttach(remote);

        const openedLocal = lastNotification(local.socket(), 'textDocument/didOpen') as any;
        const openedRemote = lastNotification(remote.socket(), 'textDocument/didOpen') as any;
        expect(openedLocal.textDocument.uri).toBe(`coc-file://${LOCAL}/${PATH}`);
        expect(openedRemote.textDocument.uri).toBe(`coc-file://${REMOTE}/${PATH}`);
        expect(openedLocal.textDocument.text).toBe('export const a = 1;');
        expect(openedRemote.textDocument.text).toBe('export const b = 2;');
    });

    it('keeps an unsaved edit on the host that owns the file', () => {
        const localView = local.store.open({ path: PATH, text: 'export const a = 1;' });
        remote.store.open({ path: PATH, text: 'export const a = 1;' });
        local.socket().open();
        remote.socket().open();
        completeAttach(local);
        completeAttach(remote);

        localView.update('export const a = 2;');

        expect(lastNotification(local.socket(), 'textDocument/didChange')).toBeDefined();
        expect(lastNotification(remote.socket(), 'textDocument/didChange')).toBeUndefined();
        expect(remote.store.peek(PATH)?.text).toBe('export const a = 1;');
        expect(remote.store.peek(PATH)?.dirty).toBe(false);
    });

    it('resolves a request only from the host it was sent to', async () => {
        const localView = local.store.open({ path: PATH, text: 'export const a = 1;' });
        remote.store.open({ path: PATH, text: 'export const a = 1;' });
        local.socket().open();
        remote.socket().open();
        completeAttach(local);
        completeAttach(remote);

        const pending = localView.sendRequest('textDocument/hover', localView.documentParams());
        const request = local.socket().sentOfType('lsp-request').at(-1) as any;
        expect(remote.socket().sentOfType('lsp-request')).toHaveLength(0);
        expect(request.params.textDocument.uri).toBe(`coc-file://${LOCAL}/${PATH}`);

        // The two clients mint request ids independently, so the remote host can
        // legitimately use the same one. Answering there must change nothing here.
        remote.socket().emit({
            type: 'lsp-response',
            attachmentId: `att-${REMOTE}`,
            id: request.id,
            result: { contents: 'the wrong repo' },
        });
        let settled = false;
        void pending.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        local.socket().emit({
            type: 'lsp-response',
            attachmentId: `att-${LOCAL}`,
            id: request.id,
            result: { contents: 'the right repo' },
        });
        await expect(pending).resolves.toEqual({ contents: 'the right repo' });
    });

    it('publishes diagnostics only against the workspace that reported them', () => {
        const localView = local.store.open({ path: PATH, text: 'export const a = 1;' });
        const remoteView = remote.store.open({ path: PATH, text: 'export const a = 1;' });
        local.socket().open();
        remote.socket().open();
        completeAttach(local);
        completeAttach(remote);

        remote.socket().emit({
            type: 'lsp-notification',
            sessionKey: `${REMOTE}::session-a::typescript::/repo`,
            method: 'textDocument/publishDiagnostics',
            params: {
                uri: `coc-file://${REMOTE}/${PATH}`,
                diagnostics: [{
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                    message: 'remote only',
                }],
            },
        });

        expect(remoteView.getDiagnostics().map((entry) => entry.message)).toEqual(['remote only']);
        expect(localView.getDiagnostics()).toEqual([]);
    });

    it('ignores a diagnostic addressed to another workspace’s copy of the path', () => {
        const localView = local.store.open({ path: PATH, text: 'export const a = 1;' });
        local.socket().open();
        completeAttach(local);

        // Same relative path, wrong owner. The document filters on its own URI,
        // so a host that mislabelled a payload cannot mark the wrong file.
        local.socket().emit({
            type: 'lsp-notification',
            sessionKey: `${LOCAL}::session-a::typescript::/repo`,
            method: 'textDocument/publishDiagnostics',
            params: {
                uri: `coc-file://${REMOTE}/${PATH}`,
                diagnostics: [{
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                    message: 'not this document',
                }],
            },
        });

        expect(localView.getDiagnostics()).toEqual([]);
    });

    it('closes only the owner’s document when one workspace’s views go away', () => {
        const localView = local.store.open({ path: PATH, text: 'export const a = 1;' });
        remote.store.open({ path: PATH, text: 'export const a = 1;' });
        local.socket().open();
        remote.socket().open();
        completeAttach(local);
        completeAttach(remote);

        localView.close();

        expect(lastNotification(local.socket(), 'textDocument/didClose')).toBeDefined();
        expect(local.socket().sentOfType('lsp-detach')).toHaveLength(1);
        expect(remote.socket().sentOfType('lsp-detach')).toHaveLength(0);
        expect(remote.store.documentCount).toBe(1);
    });
});
