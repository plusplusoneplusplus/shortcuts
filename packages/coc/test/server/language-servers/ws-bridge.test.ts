/**
 * The `/ws/language-server` bridge, driven over a real WebSocket against a real
 * session manager and the non-TypeScript fixture server. Covers workspace
 * scoping at the upgrade, document attachment, request and notification relay
 * in both directions, URI-based access refusal, cancellation, and the handle
 * release that a closed socket owes the manager.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { LanguageServerManager } from '../../../src/server/language-servers/manager';
import { LanguageServerWebSocketServer } from '../../../src/server/language-servers/ws-bridge';
import type { LanguageServerServerMessage } from '../../../src/server/language-servers/ws-bridge';
import { writeLanguageServerConfig } from '../../../src/server/language-servers/repository';
import { browserDocumentUri } from '../../../src/server/language-servers/uri-mapping';
import { attachWebSocketUpgradeHandler, ProcessWebSocketServer } from '../../../src/server/streaming/websocket';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');
const WORKSPACE_ID = 'ws-a';

const cleanups: (() => Promise<void> | void)[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
    }
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function echoDefinition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'echo',
        displayName: 'Echo Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: process.execPath,
        args: [FIXTURE_SERVER],
        rootMarkers: ['package.json'],
        enabled: true,
        ...overrides,
    };
}

interface Harness {
    manager: LanguageServerManager;
    bridge: LanguageServerWebSocketServer;
    workspaceRoot: string;
    port: number;
    connect: (query?: string) => Promise<Client>;
}

/** Buffers every server message so a test never races the socket. */
class Client {
    readonly socket: WebSocket;
    readonly received: LanguageServerServerMessage[] = [];
    closeCode?: number;
    private waiters: { match: (msg: LanguageServerServerMessage) => boolean; resolve: (msg: any) => void }[] = [];

    constructor(socket: WebSocket) {
        this.socket = socket;
        socket.on('message', (raw: Buffer) => {
            const message = JSON.parse(raw.toString('utf-8')) as LanguageServerServerMessage;
            this.received.push(message);
            this.waiters = this.waiters.filter((waiter) => {
                if (!waiter.match(message)) {
                    return true;
                }
                waiter.resolve(message);
                return false;
            });
        });
        socket.on('close', (code: number) => { this.closeCode = code; });
    }

    send(message: unknown): void {
        this.socket.send(JSON.stringify(message));
    }

    /** Resolves with the first message — buffered or future — that matches. */
    async next<T extends LanguageServerServerMessage['type']>(
        type: T,
        predicate: (msg: any) => boolean = () => true,
    ): Promise<Extract<LanguageServerServerMessage, { type: T }>> {
        const match = (msg: LanguageServerServerMessage): boolean => msg.type === type && predicate(msg);
        const buffered = this.received.find(match);
        if (buffered) {
            return buffered as any;
        }
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 15_000);
            this.waiters.push({
                match,
                resolve: (msg) => { clearTimeout(timer); resolve(msg); },
            });
        });
    }

    async attach(filePath: string): Promise<Extract<LanguageServerServerMessage, { type: 'lsp-attached' }>> {
        this.send({ type: 'lsp-attach', requestId: `r-${filePath}`, path: filePath });
        return await this.next('lsp-attached', (msg) => msg.requestId === `r-${filePath}`);
    }

    async request(attachmentId: string, id: string, method: string, params?: unknown): Promise<any> {
        this.send({ type: 'lsp-request', attachmentId, id, method, params });
        return await this.next('lsp-response', (msg) => msg.id === id);
    }

    async close(): Promise<void> {
        if (this.socket.readyState === WebSocket.OPEN) {
            await new Promise<void>((resolve) => {
                this.socket.once('close', () => resolve());
                this.socket.close();
            });
        }
    }
}

async function createHarness(
    options: {
        definitions?: LanguageServerDefinition[];
        enabled?: boolean;
        maxSessions?: number;
        requestTimeoutMs?: number;
        workspaces?: { id: string; rootPath: string }[];
    } = {},
): Promise<Harness> {
    const dataDir = tempDir('coc-lsp-bridge-data-');
    const workspaceRoot = tempDir('coc-lsp-bridge-repo-');
    const write = writeLanguageServerConfig(dataDir, WORKSPACE_ID, {
        enabled: options.enabled ?? true,
        definitions: options.definitions ?? [echoDefinition()],
    });
    expect(write.ok).toBe(true);

    const manager = new LanguageServerManager({
        dataDir,
        maxSessions: options.maxSessions,
        startTimeoutMs: 10_000,
        requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
    });
    const workspaces = options.workspaces ?? [{ id: WORKSPACE_ID, rootPath: workspaceRoot }];
    const bridge = new LanguageServerWebSocketServer({ getWorkspaces: async () => workspaces }, manager);

    const server = http.createServer();
    attachWebSocketUpgradeHandler(server, new ProcessWebSocketServer(), undefined, bridge);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const clients: Client[] = [];
    cleanups.push(async () => {
        for (const client of clients) {
            await client.close();
        }
        bridge.closeAll();
        await manager.dispose();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const connect = async (query = `workspaceId=${WORKSPACE_ID}&editingSessionId=session-1`): Promise<Client> => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/language-server?${query}`);
        const client = new Client(socket);
        clients.push(client);
        await new Promise<void>((resolve, reject) => {
            socket.once('open', () => resolve());
            socket.once('error', reject);
        });
        return client;
    };

    return { manager, bridge, workspaceRoot, port, connect };
}

describe('language-server WebSocket bridge', () => {
    it('welcomes a socket scoped to a workspace and an editing session', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const welcome = await client.next('lsp-welcome');
        expect(welcome.workspaceId).toBe(WORKSPACE_ID);
        expect(welcome.editingSessionId).toBe('session-1');
    });

    it('closes a socket that names no workspace or editing session', async () => {
        const harness = await createHarness();
        const client = await harness.connect('editingSessionId=session-1');
        await client.next('lsp-error');
        await new Promise<void>((resolve) => client.socket.once('close', () => resolve()));
        expect(client.closeCode).toBe(4001);
    });

    it('closes a socket naming a workspace this host does not own', async () => {
        const harness = await createHarness();
        const client = await harness.connect('workspaceId=ws-other&editingSessionId=session-1');
        const error = await client.next('lsp-error');
        expect(error.message).toBe('Unknown workspace');
        await new Promise<void>((resolve) => client.socket.once('close', () => resolve()));
        expect(client.closeCode).toBe(4001);
    });

    it('attaches a document and reports the server serving it', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        expect(attached.documentUri).toBe(browserDocumentUri(WORKSPACE_ID, 'src/notes.txt'));
        expect(attached.languageId).toBe('plaintext');
        expect(attached.definitionId).toBe('echo');
        expect(attached.displayName).toBe('Echo Test Server');
        expect(attached.sessionKey).toContain('session-1');
    });

    it('starts the server when a document attaches and reports the ready generation', async () => {
        // Lazy startup is "after an eligible file opens", not "after the first
        // request": a notification cannot spawn a process, so without this the
        // browser's opening `didOpen` would be dropped and the server would
        // never learn about the document.
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        expect(attached.state.status).not.toBe('ready');

        const status = await client.next('lsp-status', (msg) => msg.state.status === 'ready');

        expect(status.sessionKey).toBe(attached.sessionKey);
        expect(status.state.generation).toBe(1);
    });

    it('reports a start that fails instead of leaving the document silent', async () => {
        const harness = await createHarness({
            definitions: [echoDefinition({ command: process.execPath, args: ['-e', 'process.exit(3)'] })],
        });
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');

        const status = await client.next('lsp-status', (msg) => msg.state.status !== 'starting');

        expect(status.sessionKey).toBe(attached.sessionKey);
        expect(['failed', 'unavailable']).toContain(status.state.status);
        expect(status.state.generation).toBe(0);
    });

    it('refuses a document path that climbs out of the workspace', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        client.send({ type: 'lsp-attach', requestId: 'r1', path: '../../etc/passwd' });
        const unavailable = await client.next('lsp-unavailable', (msg) => msg.requestId === 'r1');
        expect(unavailable.reason).toBe('invalid-path');
        expect(harness.manager.size).toBe(0);
    });

    it('reports no-definition for a file no server claims', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        client.send({ type: 'lsp-attach', requestId: 'r1', path: 'README.md' });
        const unavailable = await client.next('lsp-unavailable', (msg) => msg.requestId === 'r1');
        expect(unavailable.reason).toBe('no-definition');
    });

    it('reports disabled when language support is off for the workspace', async () => {
        const harness = await createHarness({ enabled: false });
        const client = await harness.connect();
        client.send({ type: 'lsp-attach', requestId: 'r1', path: 'src/notes.txt' });
        const unavailable = await client.next('lsp-unavailable', (msg) => msg.requestId === 'r1');
        expect(unavailable.reason).toBe('disabled');
    });

    it('relays a request and maps document URIs in both directions', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        const documentUri = attached.documentUri;

        const response = await client.request(attached.attachmentId, 'q1', 'echo', {
            textDocument: { uri: documentUri },
            position: { line: 1, character: 2 },
        });

        // The echo server returns exactly what it received, so a browser URI
        // coming back out proves the outbound mapping ran on the inbound value.
        expect(response.error).toBeUndefined();
        expect(response.result.textDocument.uri).toBe(documentUri);
        expect(response.result.position).toEqual({ line: 1, character: 2 });
    });

    it('forwards ordered indexing states and keeps the request alive', async () => {
        const harness = await createHarness({ requestTimeoutMs: 40 });
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        await client.next('lsp-status', (msg) => msg.state.status === 'ready');

        const response = await client.request(attached.attachmentId, 'q-index', 'indexing', { delayMs: 100 });

        expect(response.error).toBeUndefined();
        expect(response.result).toEqual({ indexed: true });
        const statuses = client.received
            .filter((msg): msg is Extract<LanguageServerServerMessage, { type: 'lsp-status' }> =>
                msg.type === 'lsp-status' && msg.sessionKey === attached.sessionKey,
            )
            .map((msg) => msg.state.status);
        expect(statuses).toEqual(['starting', 'ready', 'indexing', 'ready']);
    });

    it('refuses a request naming a document in another workspace', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');

        const response = await client.request(attached.attachmentId, 'q1', 'echo', {
            textDocument: { uri: browserDocumentUri('ws-other', 'src/notes.txt') },
        });
        expect(response.error?.code).toBe('forbidden-uri');
        expect(response.result).toBeUndefined();
    });

    it('refuses a request naming a host file path directly', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');

        const response = await client.request(attached.attachmentId, 'q1', 'echo', {
            textDocument: { uri: 'file:///etc/passwd' },
        });
        expect(response.error?.code).toBe('forbidden-uri');
    });

    it('answers a request for an attachment it does not know', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        await client.next('lsp-welcome');
        const response = await client.request('missing', 'q1', 'echo', {});
        expect(response.error?.code).toBe('unknown-attachment');
    });

    it('forwards a notification and maps URIs on the server notification back', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        // A notification alone cannot spawn, so wait until the attach-triggered
        // start has handshaken before sending one.
        await client.next('lsp-status', (msg) => msg.state.status === 'ready');

        client.send({
            type: 'lsp-notify',
            attachmentId: attached.attachmentId,
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: attached.documentUri, languageId: 'plaintext', version: 1, text: 'hi' } },
        });

        const notification = await client.next('lsp-notification', (msg) => msg.method === 'textDocument/publishDiagnostics');
        expect(notification.sessionKey).toBe(attached.sessionKey);
        const params = notification.params as { uri: string; diagnostics: { message: string }[] };
        expect(params.uri).toBe(attached.documentUri);
        // Only URI fields are translated: free text keeps whatever the server wrote.
        expect(params.diagnostics[0].message).toContain('file://');
    });

    it('refuses a notification naming a foreign document without sending it', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        await client.request(attached.attachmentId, 'q1', 'echo', {});

        client.send({
            type: 'lsp-notify',
            attachmentId: attached.attachmentId,
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: 'file:///etc/passwd', languageId: 'plaintext', version: 1, text: 'hi' } },
        });
        const error = await client.next('lsp-error');
        expect(error.message).toContain('outside this workspace');
        expect(client.received.some((msg) => msg.type === 'lsp-notification')).toBe(false);
    });

    it('cancels an in-flight request on request', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        await client.request(attached.attachmentId, 'q1', 'echo', {});

        client.send({ type: 'lsp-request', attachmentId: attached.attachmentId, id: 'q2', method: 'slow', params: {} });
        // The request has to reach the server before the cancel is meaningful.
        await new Promise((resolve) => setTimeout(resolve, 50));
        client.send({ type: 'lsp-cancel', attachmentId: attached.attachmentId, id: 'q2' });

        const response = await client.next('lsp-response', (msg) => msg.id === 'q2');
        expect(response.error?.code).toBe('cancelled');
    });

    it('reports a server-side failure as a response error and a status update', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');

        const response = await client.request(attached.attachmentId, 'q1', 'fail', {});
        expect(response.error?.code).toBe('server-error');
        const status = await client.next('lsp-status', (msg) => msg.sessionKey === attached.sessionKey);
        expect(status.state.definitionId).toBe('echo');
    });

    it('stops serving an attachment after the client detaches it', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');

        client.send({ type: 'lsp-detach', attachmentId: attached.attachmentId });
        const detached = await client.next('lsp-detached', (msg) => msg.attachmentId === attached.attachmentId);
        expect(detached.reason).toBe('client-request');

        const response = await client.request(attached.attachmentId, 'q1', 'echo', {});
        expect(response.error?.code).toBe('unknown-attachment');
    });

    it('releases every handle when the socket closes, freeing the session for eviction', async () => {
        const harness = await createHarness({ maxSessions: 1 });
        const first = await harness.connect();
        await first.attach('src/notes.txt');
        expect(harness.manager.size).toBe(1);

        await first.close();
        // A held session would make the next acquire fail with `capacity`.
        const second = await harness.connect(`workspaceId=${WORKSPACE_ID}&editingSessionId=session-2`);
        const attached = await second.attach('src/notes.txt');
        expect(attached.sessionKey).toContain('session-2');
        expect(harness.manager.size).toBe(1);
    });

    it('keeps two editing sessions on separate language-server sessions', async () => {
        const harness = await createHarness();
        const first = await harness.connect();
        const second = await harness.connect(`workspaceId=${WORKSPACE_ID}&editingSessionId=session-2`);
        const a = await first.attach('src/notes.txt');
        const b = await second.attach('src/notes.txt');
        expect(a.sessionKey).not.toBe(b.sessionKey);
        expect(harness.manager.size).toBe(2);
    });

    it('detaches every document when the manager closes their session', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');

        await harness.manager.disposeWorkspace(WORKSPACE_ID);
        const detached = await client.next('lsp-detached', (msg) => msg.attachmentId === attached.attachmentId);
        expect(detached.reason).toBe('workspace-removed');
    });

    it('restarts the server behind a document on request, keeping the attachment', async () => {
        // The user's retry: a new process, without restarting CoC and without
        // the browser losing the document it is looking at.
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        await client.next('lsp-status', (msg) => msg.state.status === 'ready');

        client.send({ type: 'lsp-restart', attachmentId: attached.attachmentId });

        const restarted = await client.next(
            'lsp-status',
            (msg) => msg.state.status === 'ready' && msg.state.generation === 2,
        );
        expect(restarted.sessionKey).toBe(attached.sessionKey);
        // A new handshake generation is the browser's cue to replay, and the
        // same attachment id still addresses the session.
        const echo = await client.request(attached.attachmentId, 'e1', 'echo', { value: 'after restart' });
        expect(echo.result).toEqual({ value: 'after restart' });
        expect(client.received.some((msg) => msg.type === 'lsp-detached')).toBe(false);
    });

    it('reports the restart while it is happening, not only when it lands', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        await client.next('lsp-status', (msg) => msg.state.status === 'ready');
        const before = client.received.length;

        client.send({ type: 'lsp-restart', attachmentId: attached.attachmentId });
        await client.next('lsp-status', (msg) => msg.state.status === 'ready' && msg.state.generation === 2);

        const during = client.received
            .slice(before)
            .filter((msg): msg is Extract<LanguageServerServerMessage, { type: 'lsp-status' }> => msg.type === 'lsp-status')
            .map((msg) => msg.state.status);
        expect(during).toContain('starting');
    });

    it('restarts once when two documents on the same session both ask', async () => {
        // One session serves every document under a project root. Two panes
        // pressing retry must not stop and start the process twice.
        const harness = await createHarness();
        const client = await harness.connect();
        const first = await client.attach('src/notes.txt');
        const second = await client.attach('src/other.txt');
        expect(second.sessionKey).toBe(first.sessionKey);
        await client.next('lsp-status', (msg) => msg.state.status === 'ready');

        client.send({ type: 'lsp-restart', attachmentId: first.attachmentId });
        client.send({ type: 'lsp-restart', attachmentId: second.attachmentId });

        await client.next('lsp-status', (msg) => msg.state.status === 'ready' && msg.state.generation === 2);
        const echo = await client.request(first.attachmentId, 'e1', 'echo', { value: 'still one server' });
        expect(echo.result).toEqual({ value: 'still one server' });
        const generations = client.received
            .filter((msg): msg is Extract<LanguageServerServerMessage, { type: 'lsp-status' }> => msg.type === 'lsp-status')
            .map((msg) => msg.state.generation);
        expect(Math.max(...generations)).toBe(2);
    });

    it('brings a failed server back, because a retry is what clears the budget', async () => {
        const harness = await createHarness({
            definitions: [echoDefinition({ command: 'coc-language-server-that-does-not-exist', args: [] })],
        });
        const client = await harness.connect();
        const attached = await client.attach('src/notes.txt');
        const failed = await client.next('lsp-status', (msg) => msg.state.status !== 'starting');
        expect(['failed', 'unavailable']).toContain(failed.state.status);

        client.send({ type: 'lsp-restart', attachmentId: attached.attachmentId });

        // Still broken, so it fails again — but it tried, and the browser was
        // told about the attempt rather than left on a stale status.
        const retried = await client.next(
            'lsp-status',
            (msg) => msg.state.status === 'starting' || msg.state.status === 'reconnecting',
        );
        expect(retried.sessionKey).toBe(attached.sessionKey);
    });

    it('ignores a restart naming an attachment it does not know', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        await client.next('lsp-welcome');
        client.send({ type: 'lsp-restart', attachmentId: 'not-an-attachment' });
        client.send({ type: 'ping' });
        await client.next('pong');
        expect(client.socket.readyState).toBe(WebSocket.OPEN);
    });

    it('answers a ping so a client can check liveness', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        client.send({ type: 'ping' });
        await client.next('pong');
    });

    it('ignores an unparseable or unknown message instead of dropping the socket', async () => {
        const harness = await createHarness();
        const client = await harness.connect();
        await client.next('lsp-welcome');
        client.socket.send('not json');
        client.send({ type: 'nonsense' });
        client.send({ type: 'ping' });
        await client.next('pong');
        expect(client.socket.readyState).toBe(WebSocket.OPEN);
    });
});
