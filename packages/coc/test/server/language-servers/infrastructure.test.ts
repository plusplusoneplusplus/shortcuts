/**
 * Production wiring for language support.
 *
 * `createLanguageServerInfrastructure` is what turns the session manager and
 * the WebSocket bridge from test-only objects into running server state, so
 * this suite covers the two ends of that lifetime: the manager is published
 * for workspace removal to find, and a real `createExecutionServer` serves
 * `/ws/language-server`, stops a workspace's servers when the workspace is
 * deleted, and releases everything on shutdown.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { WebSocket } from 'ws';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { createLanguageServerInfrastructure } from '../../../src/server/infrastructure/language-server-infrastructure';
import {
    disposeLanguageServersForWorkspace,
    getActiveLanguageServerManager,
} from '../../../src/server/language-servers/active';
import { writeLanguageServerConfig } from '../../../src/server/language-servers/repository';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import type { LanguageServerServerMessage } from '../../../src/server/language-servers/ws-bridge';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');

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

function echoDefinition(): LanguageServerDefinition {
    return {
        id: 'echo',
        displayName: 'Echo Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: process.execPath,
        args: [FIXTURE_SERVER],
        rootMarkers: ['package.json'],
        enabled: true,
    };
}

/** A data dir with language support enabled for the given workspace ids. */
function enabledDataDir(workspaceIds: string[]): string {
    const dataDir = tempDir('coc-lsp-infra-data-');
    for (const id of workspaceIds) {
        const write = writeLanguageServerConfig(dataDir, id, {
            enabled: true,
            definitions: [echoDefinition()],
        });
        expect(write.ok).toBe(true);
    }
    return dataDir;
}

function makeStore(workspaces: { id: string; rootPath: string }[]): any {
    return { getWorkspaces: async () => workspaces };
}

// ============================================================================
// Factory and the published manager
// ============================================================================

describe('createLanguageServerInfrastructure', () => {
    it('publishes its manager so workspace removal can reach it', () => {
        const dataDir = enabledDataDir(['ws-a']);
        const infra = createLanguageServerInfrastructure(makeStore([]), dataDir);
        cleanups.push(() => infra.dispose());

        expect(getActiveLanguageServerManager()).toBe(infra.manager);
    });

    it('stops only the removed workspace’s sessions', async () => {
        const dataDir = enabledDataDir(['ws-a', 'ws-b']);
        const rootA = tempDir('coc-lsp-infra-a-');
        const rootB = tempDir('coc-lsp-infra-b-');
        const infra = createLanguageServerInfrastructure(makeStore([]), dataDir);
        cleanups.push(() => infra.dispose());

        const a = infra.manager.acquire({
            workspaceId: 'ws-a', workspaceRoot: rootA,
            editingSessionId: 'session-1', relativePath: 'notes.txt',
        });
        const b = infra.manager.acquire({
            workspaceId: 'ws-b', workspaceRoot: rootB,
            editingSessionId: 'session-1', relativePath: 'notes.txt',
        });
        expect(a.ok && b.ok).toBe(true);
        expect(infra.manager.size).toBe(2);

        const closed: string[] = [];
        infra.manager.onSessionClosed((event) => closed.push(`${event.workspaceId}:${event.reason}`));
        await disposeLanguageServersForWorkspace('ws-a');

        expect(closed).toEqual(['ws-a:workspace-removed']);
        expect(infra.manager.listStates().map((s) => s.definitionId)).toHaveLength(1);
        expect(infra.manager.listStates('ws-b')).toHaveLength(1);
        expect(infra.manager.listStates('ws-a')).toHaveLength(0);
    });

    it('unpublishes the manager and refuses new work after dispose', async () => {
        const dataDir = enabledDataDir(['ws-a']);
        const infra = createLanguageServerInfrastructure(makeStore([]), dataDir);

        await infra.dispose();
        expect(getActiveLanguageServerManager()).toBeUndefined();

        const result = infra.manager.acquire({
            workspaceId: 'ws-a', workspaceRoot: tempDir('coc-lsp-infra-gone-'),
            editingSessionId: 'session-1', relativePath: 'notes.txt',
        });
        expect(result).toEqual({ ok: false, reason: 'disabled', detail: expect.any(String) });
    });

    it('is idempotent: a second dispose is a no-op', async () => {
        const dataDir = enabledDataDir(['ws-a']);
        const infra = createLanguageServerInfrastructure(makeStore([]), dataDir);
        await infra.dispose();
        await expect(infra.dispose()).resolves.toBeUndefined();
    });

    // Regression: the unregister used to be an unconditional clear, so
    // disposing an older infrastructure erased the manager a newer one had
    // already published — workspace removal then silently stopped nothing.
    it('keeps the newer manager published when an older one is disposed', async () => {
        const dataDir = enabledDataDir(['ws-a']);
        const older = createLanguageServerInfrastructure(makeStore([]), dataDir);
        const newer = createLanguageServerInfrastructure(makeStore([]), dataDir);
        cleanups.push(() => newer.dispose());

        await older.dispose();

        expect(getActiveLanguageServerManager()).toBe(newer.manager);
    });

    it('is a no-op to dispose a workspace when nothing is composed', async () => {
        await expect(disposeLanguageServersForWorkspace('ws-nobody')).resolves.toBeUndefined();
    });
});

// ============================================================================
// Composed server
// ============================================================================

function request(url: string, options: { method?: string; body?: string } = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname, port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method ?? 'GET',
                headers: options.body ? { 'content-type': 'application/json' } : undefined,
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

/** Buffers server messages so a test never races the socket. */
function collect(socket: WebSocket): {
    next: (type: string, predicate?: (msg: any) => boolean) => Promise<any>;
    send: (msg: unknown) => void;
} {
    const received: any[] = [];
    let waiters: { match: (msg: any) => boolean; resolve: (msg: any) => void }[] = [];
    socket.on('message', (raw: Buffer) => {
        const message = JSON.parse(raw.toString('utf-8')) as LanguageServerServerMessage;
        received.push(message);
        waiters = waiters.filter((waiter) => {
            if (!waiter.match(message)) { return true; }
            waiter.resolve(message);
            return false;
        });
    });
    return {
        send: (msg) => socket.send(JSON.stringify(msg)),
        next: (type, predicate = () => true) => {
            const match = (msg: any): boolean => msg.type === type && predicate(msg);
            const buffered = received.find(match);
            if (buffered) { return Promise.resolve(buffered); }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 15_000);
                waiters.push({ match, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
            });
        },
    };
}

describe('language support on a composed execution server', () => {
    async function startServer(dataDir: string): Promise<{ url: string; close: () => Promise<void> }> {
        const store = new FileProcessStore({ dataDir });
        const server = await createExecutionServer({ port: 0, host: '127.0.0.1', store, dataDir });
        let closed = false;
        const close = async (): Promise<void> => {
            if (closed) { return; }
            closed = true;
            await server.close();
        };
        cleanups.push(close);
        return { url: server.url, close };
    }

    async function connect(url: string, query: string): Promise<ReturnType<typeof collect> & { socket: WebSocket }> {
        const socket = new WebSocket(`${url.replace('http://', 'ws://')}/ws/language-server?${query}`);
        cleanups.push(() => { socket.close(); });
        await new Promise<void>((resolve, reject) => {
            socket.once('open', () => resolve());
            socket.once('error', reject);
        });
        return { ...collect(socket), socket };
    }

    it('serves /ws/language-server from the running server', async () => {
        const dataDir = enabledDataDir(['ws-lsp-1']);
        const server = await startServer(dataDir);
        const workspaceRoot = tempDir('coc-lsp-infra-repo-');
        const registered = await request(`${server.url}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-lsp-1', name: 'LSP', rootPath: workspaceRoot }),
        });
        expect(registered.status).toBe(201);

        const client = await connect(server.url, 'workspaceId=ws-lsp-1&editingSessionId=session-1');
        const welcome = await client.next('lsp-welcome');
        expect(welcome.workspaceId).toBe('ws-lsp-1');
        expect(welcome.editingSessionId).toBe('session-1');
    });

    it('stops a workspace’s language servers when the workspace is deleted', async () => {
        const dataDir = enabledDataDir(['ws-lsp-2']);
        const server = await startServer(dataDir);
        const workspaceRoot = tempDir('coc-lsp-infra-repo-');
        fs.writeFileSync(path.join(workspaceRoot, 'notes.txt'), 'hello\n');
        await request(`${server.url}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-lsp-2', name: 'LSP', rootPath: workspaceRoot }),
        });

        const client = await connect(server.url, 'workspaceId=ws-lsp-2&editingSessionId=session-1');
        await client.next('lsp-welcome');
        client.send({ type: 'lsp-attach', requestId: 'r1', path: 'notes.txt' });
        const attached = await client.next('lsp-attached', (msg) => msg.requestId === 'r1');
        expect(attached.definitionId).toBe('echo');

        const deleted = await request(`${server.url}/api/workspaces/ws-lsp-2`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);

        const detached = await client.next('lsp-detached', (msg) => msg.attachmentId === attached.attachmentId);
        expect(detached.reason).toBe('workspace-removed');
    });

    it('releases language support on server shutdown', async () => {
        const dataDir = enabledDataDir(['ws-lsp-3']);
        const server = await startServer(dataDir);
        expect(getActiveLanguageServerManager()).toBeDefined();

        await server.close();

        expect(getActiveLanguageServerManager()).toBeUndefined();
    });
});
