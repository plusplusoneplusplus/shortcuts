/**
 * Browser transport client for `/ws/language-server`.
 *
 * The socket is faked, but everything above it is the real client: attach
 * bookkeeping, request correlation, cancellation, reconnect and replay
 * signalling. The message shapes here are copied from the host bridge, so a
 * change to that wire protocol breaks these tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    CONTAINER_UNSUPPORTED_REASON,
    LanguageServerClient,
    LanguageServerClientError,
    getLanguageServerClient,
    resetLanguageServerClientsForTests,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';
import {
    getEditingSessionId,
    resetEditingSessionIdForTests,
} from '../../../../src/server/spa/client/react/features/language-servers/editingSession';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { FakeSocket } from './fakeLanguageTransport';

function makeClient(overrides: Record<string, unknown> = {}): LanguageServerClient {
    return new LanguageServerClient({
        workspaceId: 'ws-1',
        editingSessionId: 'session-a',
        createSocket: (url: string) => new FakeSocket(url),
        reconnectDelayMs: 5,
        maxReconnectDelayMs: 20,
        pingIntervalMs: 1000,
        attachTimeoutMs: 50,
        ...overrides,
    });
}

/** The socket the client most recently created. */
function latest(): FakeSocket {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!socket) {
        throw new Error('No socket was created');
    }
    return socket;
}

function attachedMessage(socket: FakeSocket, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const attach = socket.sentOfType('lsp-attach').at(-1);
    return {
        type: 'lsp-attached',
        requestId: attach?.requestId,
        attachmentId: 'att-1',
        sessionKey: 'ws-1::session-a::typescript::/repo',
        documentUri: 'coc-file://ws-1/src/index.ts',
        languageId: 'typescript',
        definitionId: 'typescript',
        displayName: 'TypeScript',
        state: { status: 'ready', definitionId: 'typescript', displayName: 'TypeScript' },
        ...overrides,
    };
}

describe('LanguageServerClient', () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        resetCloneRegistryForTests();
    });

    afterEach(() => {
        resetLanguageServerClientsForTests();
        resetCloneRegistryForTests();
        vi.useRealTimers();
    });

    describe('connection', () => {
        it('opens one socket carrying the workspace and editing session', () => {
            const client = makeClient();
            client.attach('src/index.ts');

            expect(FakeSocket.instances).toHaveLength(1);
            expect(latest().url).toContain('/language-server');
            expect(latest().url).toContain('workspaceId=ws-1');
            expect(latest().url).toContain('editingSessionId=session-a');
            client.dispose();
        });

        it('routes the socket to the workspace owner when the clone is remote', () => {
            registerCloneBaseUrls([{ workspaceId: 'ws-1', baseUrl: 'http://10.0.0.5:4100' }]);
            const client = makeClient();
            client.attach('src/index.ts');

            expect(latest().url.startsWith('ws://10.0.0.5:4100/')).toBe(true);
            client.dispose();
        });

        it('multiplexes several documents over a single socket', () => {
            const client = makeClient();
            client.attach('src/a.ts');
            client.attach('src/b.ts');
            latest().open();

            expect(FakeSocket.instances).toHaveLength(1);
            expect(latest().sentOfType('lsp-attach').map((m) => m.path)).toEqual(['src/a.ts', 'src/b.ts']);
            client.dispose();
        });

        it('closes the socket once the last view is released', () => {
            const client = makeClient();
            const first = client.attach('src/a.ts');
            const second = client.attach('src/b.ts');
            latest().open();

            first.release();
            expect(latest().closed).toBeNull();
            second.release();
            expect(latest().closed).not.toBeNull();
            expect(client.attachmentCount).toBe(0);
        });
    });

    describe('attach bookkeeping', () => {
        it('shares one host attachment between two views of the same file', () => {
            const client = makeClient();
            const explorer = client.attach('src/index.ts');
            const panel = client.attach('src/index.ts');
            const socket = latest();
            socket.open();

            expect(socket.sentOfType('lsp-attach')).toHaveLength(1);
            socket.emit(attachedMessage(socket));
            expect(explorer.getInfo()?.attachmentId).toBe('att-1');
            expect(panel.getInfo()?.attachmentId).toBe('att-1');

            // Closing one view keeps the document open for the other (AC-02).
            explorer.release();
            expect(socket.sentOfType('lsp-detach')).toHaveLength(0);
            expect(panel.getInfo()?.attachmentId).toBe('att-1');

            panel.release();
            expect(socket.sentOfType('lsp-detach')).toHaveLength(1);
            client.dispose();
        });

        it('normalizes windows-style and leading-slash paths to one document', () => {
            const client = makeClient();
            client.attach('src\\index.ts');
            client.attach('/src/index.ts');
            const socket = latest();
            socket.open();

            expect(socket.sentOfType('lsp-attach')).toHaveLength(1);
            expect(socket.sentOfType('lsp-attach')[0].path).toBe('src/index.ts');
            client.dispose();
        });

        it('reports an unavailable document without retrying', async () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            const seen: { reason: string; detail: string }[] = [];
            handle.onUnavailable((info) => seen.push(info));

            socket.emit({
                type: 'lsp-unavailable',
                requestId: socket.sentOfType('lsp-attach')[0].requestId,
                reason: 'disabled',
                detail: 'Language support is disabled for this workspace.',
            });

            expect(seen).toEqual([{ reason: 'disabled', detail: 'Language support is disabled for this workspace.' }]);
            expect(handle.getUnavailable()?.reason).toBe('disabled');
            expect(socket.sentOfType('lsp-attach')).toHaveLength(1);
            // A caller must fail fast rather than wait out the attach timeout.
            await expect(handle.sendRequest('textDocument/hover')).rejects.toMatchObject({ code: 'disabled' });
            client.dispose();
        });

        it('detaches an attachment that arrives after its view was released', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            // A second document keeps the socket open past the release.
            const keepAlive = client.attach('src/other.ts');
            const socket = latest();
            socket.open();
            const pendingAttach = attachedMessage(socket, {
                requestId: socket.sentOfType('lsp-attach')[0].requestId,
            });

            handle.release();
            socket.emit(pendingAttach);

            // Without this the host would hold a session reference forever.
            expect(socket.sentOfType('lsp-detach').map((m) => m.attachmentId)).toEqual(['att-1']);
            keepAlive.release();
        });
    });

    describe('requests', () => {
        it('correlates a response with its request', async () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            const promise = handle.sendRequest('textDocument/hover', { line: 1 });
            const request = socket.sentOfType('lsp-request')[0];
            expect(request.method).toBe('textDocument/hover');
            expect(request.attachmentId).toBe('att-1');

            socket.emit({ type: 'lsp-response', attachmentId: 'att-1', id: request.id, result: { contents: 'hi' } });
            await expect(promise).resolves.toEqual({ contents: 'hi' });
            client.dispose();
        });

        it('waits for the attachment before sending an early request', async () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();

            const promise = handle.sendRequest('textDocument/definition');
            expect(socket.sentOfType('lsp-request')).toHaveLength(0);

            socket.emit(attachedMessage(socket));
            await Promise.resolve();
            const request = socket.sentOfType('lsp-request')[0];
            expect(request).toBeDefined();
            socket.emit({ type: 'lsp-response', attachmentId: 'att-1', id: request.id, result: [] });
            await expect(promise).resolves.toEqual([]);
            client.dispose();
        });

        it('rejects with the server error code', async () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            const promise = handle.sendRequest('textDocument/hover');
            const request = socket.sentOfType('lsp-request')[0];
            socket.emit({
                type: 'lsp-response',
                attachmentId: 'att-1',
                id: request.id,
                error: { code: 'timeout', message: 'Request timed out' },
            });

            await expect(promise).rejects.toBeInstanceOf(LanguageServerClientError);
            await expect(promise).rejects.toMatchObject({ code: 'timeout' });
            client.dispose();
        });

        it('cancels a superseded request on the host', async () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            const controller = new AbortController();
            const promise = handle.sendRequest('textDocument/completion', {}, { signal: controller.signal });
            const request = socket.sentOfType('lsp-request')[0];
            controller.abort();

            await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
            expect(socket.sentOfType('lsp-cancel')[0]).toMatchObject({ attachmentId: 'att-1', id: request.id });

            // A late reply for a cancelled request must not resurface.
            socket.emit({ type: 'lsp-response', attachmentId: 'att-1', id: request.id, result: { items: [] } });
            client.dispose();
        });

        it('rejects a request made after the document was closed', async () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));
            handle.release();

            await expect(handle.sendRequest('textDocument/hover')).rejects.toMatchObject({ code: 'released' });
        });

        it('drops notifications while the attachment is not live', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();

            handle.sendNotification('textDocument/didChange', { version: 2 });
            expect(socket.sentOfType('lsp-notify')).toHaveLength(0);

            socket.emit(attachedMessage(socket));
            handle.sendNotification('textDocument/didChange', { version: 3 });
            expect(socket.sentOfType('lsp-notify')).toHaveLength(1);
            client.dispose();
        });
    });

    describe('server-originated traffic', () => {
        it('delivers session notifications to every document on that session', () => {
            const client = makeClient();
            const a = client.attach('src/a.ts');
            const b = client.attach('src/b.ts');
            const socket = latest();
            socket.open();
            const attaches = socket.sentOfType('lsp-attach');
            socket.emit(attachedMessage(socket, { requestId: attaches[0].requestId, attachmentId: 'att-a' }));
            socket.emit(attachedMessage(socket, { requestId: attaches[1].requestId, attachmentId: 'att-b' }));

            const seenA: string[] = [];
            const seenB: string[] = [];
            a.onNotification((method) => seenA.push(method));
            b.onNotification((method) => seenB.push(method));
            socket.emit({
                type: 'lsp-notification',
                sessionKey: 'ws-1::session-a::typescript::/repo',
                method: 'textDocument/publishDiagnostics',
                params: { uri: 'coc-file://ws-1/src/a.ts', diagnostics: [] },
            });

            expect(seenA).toEqual(['textDocument/publishDiagnostics']);
            expect(seenB).toEqual(['textDocument/publishDiagnostics']);
            client.dispose();
        });

        it('folds a status update into the attachment info', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            socket.emit({
                type: 'lsp-status',
                sessionKey: 'ws-1::session-a::typescript::/repo',
                state: { status: 'failed', definitionId: 'typescript', displayName: 'TypeScript', detail: 'crashed' },
            });

            expect(handle.getInfo()?.state.status).toBe('failed');
            client.dispose();
        });
    });

    describe('recovery', () => {
        it('re-attaches and re-announces when the host replaces the session', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            const attachedAgain: string[] = [];
            const detached: string[] = [];
            handle.onAttached((info) => attachedAgain.push(info.attachmentId));
            handle.onDetached((reason) => detached.push(reason));

            socket.emit({ type: 'lsp-detached', attachmentId: 'att-1', reason: 'config-changed' });
            expect(detached).toEqual(['config-changed']);
            expect(handle.getInfo()).toBeNull();

            // The replay hook: the document layer resends the whole buffer here.
            expect(socket.sentOfType('lsp-attach')).toHaveLength(2);
            socket.emit(attachedMessage(socket, { attachmentId: 'att-2' }));
            expect(attachedAgain).toEqual(['att-2']);
            expect(handle.getInfo()?.attachmentId).toBe('att-2');
            client.dispose();
        });

        it('does not re-attach after the client asked to detach', () => {
            const client = makeClient();
            const handle = client.attach('src/a.ts');
            const keepAlive = client.attach('src/b.ts');
            const socket = latest();
            socket.open();
            const attaches = socket.sentOfType('lsp-attach');
            socket.emit(attachedMessage(socket, { requestId: attaches[0].requestId, attachmentId: 'att-a' }));
            socket.emit(attachedMessage(socket, { requestId: attaches[1].requestId, attachmentId: 'att-b' }));

            handle.release();
            socket.emit({ type: 'lsp-detached', attachmentId: 'att-a', reason: 'client-request' });

            expect(socket.sentOfType('lsp-attach')).toHaveLength(2);
            keepAlive.release();
        });

        it('reconnects after a dropped socket and re-attaches every document', async () => {
            vi.useFakeTimers();
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const first = latest();
            first.open();
            first.emit(attachedMessage(first));

            const detached: string[] = [];
            handle.onDetached((reason) => detached.push(reason));
            first.drop();

            expect(detached).toEqual(['connection-lost']);
            expect(client.getStatus()).toBe('closed');

            vi.advanceTimersByTime(10);
            expect(FakeSocket.instances).toHaveLength(2);
            const second = latest();
            second.open();
            expect(second.sentOfType('lsp-attach').map((m) => m.path)).toEqual(['src/index.ts']);

            second.emit(attachedMessage(second, { attachmentId: 'att-9' }));
            expect(handle.getInfo()?.attachmentId).toBe('att-9');
            client.dispose();
        });

        it('rejects in-flight requests when the socket drops', async () => {
            vi.useFakeTimers();
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            const promise = handle.sendRequest('textDocument/references');
            socket.drop();

            await expect(promise).rejects.toMatchObject({ code: 'disconnected' });
            client.dispose();
        });

        it('does not reconnect once every document is released', () => {
            vi.useFakeTimers();
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            handle.release();
            vi.advanceTimersByTime(200);

            expect(FakeSocket.instances).toHaveLength(1);
        });

        it('stops the ping timer when the socket goes away', () => {
            vi.useFakeTimers();
            const client = makeClient({ pingIntervalMs: 10 });
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();

            vi.advanceTimersByTime(25);
            expect(socket.sentOfType('ping').length).toBeGreaterThan(0);

            const before = socket.sentOfType('ping').length;
            handle.release();
            vi.advanceTimersByTime(100);
            expect(socket.sentOfType('ping')).toHaveLength(before);
        });
    });

    describe('restart', () => {
        it('asks the host to restart the server behind a live document', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            handle.restart();

            expect(socket.sentOfType('lsp-restart')).toEqual([
                { type: 'lsp-restart', attachmentId: 'att-1' },
            ]);
            client.dispose();
        });

        it('re-attaches instead, when the host refused this document', () => {
            // Support turned off, no definition, no capacity: the fix is
            // elsewhere and a fresh attach is what picks it up. Restarting a
            // process that was never started would do nothing.
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            const attach = socket.sentOfType('lsp-attach').at(-1);
            socket.emit({
                type: 'lsp-unavailable',
                requestId: attach?.requestId,
                reason: 'disabled',
                detail: 'Language support is off for this workspace.',
            });
            expect(handle.getUnavailable()?.reason).toBe('disabled');

            handle.restart();

            expect(socket.sentOfType('lsp-restart')).toHaveLength(0);
            expect(socket.sentOfType('lsp-attach')).toHaveLength(2);
            expect(handle.getUnavailable()).toBeNull();
            client.dispose();
        });

        it('retires the in-flight attach so a late reply cannot leak a session', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            const first = socket.sentOfType('lsp-attach').at(-1);

            handle.restart();
            // The host answers the attach that was already on the wire.
            socket.emit(attachedMessage(socket, { requestId: first?.requestId, attachmentId: 'stale-att' }));

            expect(handle.getInfo()).toBeNull();
            expect(socket.sentOfType('lsp-detach')).toEqual([
                { type: 'lsp-detach', attachmentId: 'stale-att' },
            ]);
            client.dispose();
        });

        it('reconnects at once when the socket is down, rather than waiting out the backoff', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            latest().open();
            latest().drop();
            const socketsBefore = FakeSocket.instances.length;

            handle.restart();

            expect(FakeSocket.instances.length).toBe(socketsBefore + 1);
            client.dispose();
        });

        it('does nothing for a view that was already closed', () => {
            const client = makeClient();
            const handle = client.attach('src/index.ts');
            const socket = latest();
            socket.open();
            socket.emit(attachedMessage(socket));

            handle.release();
            handle.restart();

            expect(socket.sentOfType('lsp-restart')).toHaveLength(0);
        });
    });

    describe('container mode', () => {
        // The dashboard is reached through the container agent proxy, which
        // forwards `/ws` and `/ws/agent-link` and destroys every other upgrade.
        // Opening the language socket there closes it before it opens and the
        // backoff runs forever, so the client must not open it at all.
        const originalConfig = (window as unknown as Record<string, unknown>).__DASHBOARD_CONFIG__;

        beforeEach(() => {
            (window as unknown as Record<string, unknown>).__DASHBOARD_CONFIG__ = {
                apiBasePath: '/api',
                wsPath: '/ws',
                containerMode: true,
            };
        });

        afterEach(() => {
            (window as unknown as Record<string, unknown>).__DASHBOARD_CONFIG__ = originalConfig;
        });

        it('opens no socket and refuses the document with the container reason', () => {
            const client = makeClient();
            const attachment = client.attach('src/index.ts');

            expect(FakeSocket.instances).toHaveLength(0);
            expect(client.getStatus()).toBe('idle');
            expect(attachment.getInfo()).toBeNull();
            expect(attachment.getUnavailable()).toEqual({
                reason: CONTAINER_UNSUPPORTED_REASON,
                detail: 'Language support is not available while this workspace is open through the container agent.',
            });
            client.dispose();
        });

        it('never schedules a reconnect, so the badge does not spin forever', () => {
            vi.useFakeTimers();
            const client = makeClient();
            client.attach('src/index.ts');

            vi.advanceTimersByTime(120_000);

            expect(FakeSocket.instances).toHaveLength(0);
            expect(client.getStatus()).toBe('idle');
            client.dispose();
        });

        it('keeps the explanation when the user retries instead of opening a socket', () => {
            const client = makeClient();
            const attachment = client.attach('src/index.ts');
            const seen: string[] = [];
            attachment.onUnavailable((info) => seen.push(info.reason));

            attachment.restart();

            expect(seen).toEqual([CONTAINER_UNSUPPORTED_REASON]);
            expect(FakeSocket.instances).toHaveLength(0);
            client.dispose();
        });

        it('fails a request with the container reason rather than waiting for the attach timeout', async () => {
            const client = makeClient();
            const attachment = client.attach('src/index.ts');

            await expect(attachment.sendRequest('textDocument/hover')).rejects.toMatchObject({
                name: 'LanguageServerClientError',
                code: CONTAINER_UNSUPPORTED_REASON,
            });
            expect(FakeSocket.instances).toHaveLength(0);
            client.dispose();
        });

        it('still opens the socket for a remote clone, whose own host is not behind the proxy', () => {
            registerCloneBaseUrls([{ workspaceId: 'ws-1', baseUrl: 'http://10.0.0.5:4100' }]);
            const client = makeClient();
            const attachment = client.attach('src/index.ts');

            expect(FakeSocket.instances).toHaveLength(1);
            expect(latest().url.startsWith('ws://10.0.0.5:4100/')).toBe(true);
            expect(attachment.getUnavailable()).toBeNull();
            client.dispose();
        });

        it('is inert when the detector says the host is reachable', () => {
            // The gate is the only thing container mode changes; with it
            // answering `null` the transport behaves exactly as before.
            const client = makeClient({ detectTransportBlock: () => null });
            client.attach('src/index.ts');

            expect(FakeSocket.instances).toHaveLength(1);
            client.dispose();
        });
    });

    describe('registry', () => {
        it('reuses one client per workspace and editing session', () => {
            const a = getLanguageServerClient('ws-1', 'session-a');
            const b = getLanguageServerClient('ws-1', 'session-a');
            const other = getLanguageServerClient('ws-2', 'session-a');
            const otherSession = getLanguageServerClient('ws-1', 'session-b');

            expect(a).toBe(b);
            expect(other).not.toBe(a);
            // Cross-window isolation starts here: a different editing session
            // gets a different host session key (AC-02).
            expect(otherSession).not.toBe(a);
        });
    });
});

describe('getEditingSessionId', () => {
    beforeEach(() => {
        resetEditingSessionIdForTests();
    });

    afterEach(() => {
        resetEditingSessionIdForTests();
    });

    it('is stable within a tab', () => {
        const first = getEditingSessionId();
        expect(getEditingSessionId()).toBe(first);
        expect(first).toBeTruthy();
    });

    it('survives a reload by living in sessionStorage', () => {
        const first = getEditingSessionId();
        // A reload keeps sessionStorage but drops module state.
        resetEditingSessionIdForTests();
        globalThis.sessionStorage?.setItem('coc.languageServers.editingSessionId', first);
        expect(getEditingSessionId()).toBe(first);
    });

    it('mints a new id when storage was cleared', () => {
        const first = getEditingSessionId();
        resetEditingSessionIdForTests();
        expect(getEditingSessionId()).not.toBe(first);
    });
});
