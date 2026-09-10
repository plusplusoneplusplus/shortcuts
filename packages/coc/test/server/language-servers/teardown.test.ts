/**
 * What is left running after language support goes away.
 *
 * The rest of the server suites prove behavior while things are up; this one
 * proves the opposite end — closing every document, removing a workspace and
 * shutting CoC down each leave no process, timer, listener or pending request
 * behind. Every case runs real fixture processes and watches their real pids
 * disappear, because a session object the manager has forgotten says nothing
 * about the child process it started.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { LanguageServerManager } from '../../../src/server/language-servers/manager';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerSessionState } from '../../../src/server/language-servers/session';
import { LanguageServerWebSocketServer, HEARTBEAT_INTERVAL_MS } from '../../../src/server/language-servers/ws-bridge';
import type { LanguageServerServerMessage } from '../../../src/server/language-servers/ws-bridge';
import { writeLanguageServerConfig } from '../../../src/server/language-servers/repository';
import { attachWebSocketUpgradeHandler, ProcessWebSocketServer } from '../../../src/server/streaming/websocket';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');

const cleanups: (() => Promise<void> | void)[] = [];
const tempDirs: string[] = [];
/** Pids the fixtures reported, so a failing case cannot leak a process. */
const spawned: number[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
    }
    vi.restoreAllMocks();
    for (const pid of spawned.splice(0)) {
        if (isRunning(pid)) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Already gone between the check and the signal.
            }
        }
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

/**
 * A definition whose process writes its pid where the test can find it.
 * `--stubborn` additionally makes it refuse `exit`, a closed stdin and
 * SIGTERM, which is the only way to exercise the escalation path.
 */
function echoDefinition(
    pidFile: string,
    overrides: Partial<LanguageServerDefinition> = {},
    extraArgs: string[] = [],
): LanguageServerDefinition {
    return {
        id: 'echo',
        displayName: 'Echo Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: process.execPath,
        args: [FIXTURE_SERVER, '--pid-file', pidFile, ...extraArgs],
        rootMarkers: ['package.json'],
        enabled: true,
        ...overrides,
    };
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

/** The pid the fixture wrote, once it is up. */
async function readPid(pidFile: string): Promise<number> {
    await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim().length > 0, 'the pid file');
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    expect(Number.isInteger(pid)).toBe(true);
    spawned.push(pid);
    return pid;
}

function pidPath(): string {
    return path.join(tempDir('coc-lsp-teardown-pid-'), 'server.pid');
}

// ============================================================================
// One session
// ============================================================================

describe('LanguageServerSession teardown', () => {
    function createSession(
        definition: LanguageServerDefinition,
        options: Partial<ConstructorParameters<typeof LanguageServerSession>[0]> = {},
    ): { session: LanguageServerSession; states: LanguageServerSessionState[] } {
        const states: LanguageServerSessionState[] = [];
        const session = new LanguageServerSession({
            definition,
            rootPath: tempDir('coc-lsp-teardown-root-'),
            startTimeoutMs: 10_000,
            requestTimeoutMs: 30_000,
            ...options,
            onStateChange: (state) => states.push(state),
        });
        cleanups.push(() => session.dispose());
        return { session, states };
    }

    it('resolves stop only once the process is really gone', async () => {
        const pidFile = pidPath();
        const { session } = createSession(echoDefinition(pidFile));
        await session.start();
        const pid = await readPid(pidFile);
        expect(isRunning(pid)).toBe(true);

        await session.stop();

        // No polling here on purpose: the guarantee is that stop does not
        // resolve while the child is still up.
        expect(isRunning(pid)).toBe(false);
    });

    // Regression: `stop` used to send SIGTERM and return without waiting, so a
    // server that traps the signal outlived the CoC process that started it.
    it('kills a server that ignores shutdown, a closed stdin and SIGTERM', async () => {
        const pidFile = pidPath();
        const { session } = createSession(echoDefinition(pidFile, {}, ['--stubborn']), { killGraceMs: 100 });
        await session.start();
        const pid = await readPid(pidFile);

        await session.stop();

        expect(isRunning(pid)).toBe(false);
    });

    it('stops the process once the last document releases the session', async () => {
        const pidFile = pidPath();
        const { session } = createSession(echoDefinition(pidFile), { idleTimeoutMs: 30 });
        const release = session.attach();
        await session.start();
        const pid = await readPid(pidFile);

        release();

        // The process can disappear just before Node delivers its exit event,
        // especially on Windows. The state transition is the public signal
        // that the asynchronous idle stop has finished.
        await waitFor(() => session.status === 'disabled', 'the idle session to stop');
        expect(isRunning(pid)).toBe(false);
    });

    // The restart timer is the one timer that survives a crash, so disposal
    // has to cancel it: a restart afterwards would spawn a process nothing
    // owns and nothing would ever stop it.
    it('never lets a scheduled restart fire after dispose', async () => {
        const pidFile = pidPath();
        const { session, states } = createSession(echoDefinition(pidFile), { restartBackoffMs: 150 });
        session.attach();
        await session.start();
        const pid = await readPid(pidFile);

        session.sendNotification('crash');
        await waitFor(() => !isRunning(pid), 'the crashed process to exit');
        const before = states.length;
        await session.dispose();

        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(states.slice(before).map((state) => state.status)).not.toContain('reconnecting');
        expect(Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)).toBe(pid);
        expect(isRunning(pid)).toBe(false);
    });
});

// ============================================================================
// The manager
// ============================================================================

describe('LanguageServerManager teardown', () => {
    interface ManagerHarness {
        manager: LanguageServerManager;
        dataDir: string;
        acquire: (workspaceId: string) => { session: LanguageServerSession; release: () => void };
        setConfig: (workspaceId: string, definitions: LanguageServerDefinition[]) => void;
    }

    function createHarness(definitionFor: (workspaceId: string) => LanguageServerDefinition): ManagerHarness {
        const dataDir = tempDir('coc-lsp-teardown-data-');
        const setConfig = (workspaceId: string, definitions: LanguageServerDefinition[]): void => {
            const write = writeLanguageServerConfig(dataDir, workspaceId, { enabled: true, definitions });
            expect(write.ok).toBe(true);
        };
        const manager = new LanguageServerManager({ dataDir, startTimeoutMs: 10_000, requestTimeoutMs: 30_000 });
        cleanups.push(() => manager.dispose());
        return {
            manager,
            dataDir,
            setConfig,
            acquire: (workspaceId: string) => {
                setConfig(workspaceId, [definitionFor(workspaceId)]);
                const result = manager.acquire({
                    workspaceId,
                    workspaceRoot: tempDir('coc-lsp-teardown-repo-'),
                    editingSessionId: 'session-1',
                    relativePath: 'notes.txt',
                });
                if (!result.ok) {
                    throw new Error(`Expected a handle, got ${result.reason}`);
                }
                return { session: result.handle.session, release: result.handle.release };
            },
        };
    }

    it('ends the removed workspace’s process and leaves the other one running', async () => {
        const pidFiles = { 'ws-a': pidPath(), 'ws-b': pidPath() };
        const harness = createHarness((workspaceId) => echoDefinition(pidFiles[workspaceId as 'ws-a']));
        const a = harness.acquire('ws-a');
        const b = harness.acquire('ws-b');
        await Promise.all([a.session.start(), b.session.start()]);
        const pidA = await readPid(pidFiles['ws-a']);
        const pidB = await readPid(pidFiles['ws-b']);

        await harness.manager.disposeWorkspace('ws-a');

        expect(isRunning(pidA)).toBe(false);
        expect(isRunning(pidB)).toBe(true);
        expect(harness.manager.size).toBe(1);
    });

    it('ends every process on shutdown and fails the requests still in flight', async () => {
        const pidFile = pidPath();
        const harness = createHarness(() => echoDefinition(pidFile));
        const { session } = harness.acquire('ws-a');
        await session.start();
        const pid = await readPid(pidFile);
        // `slow` never answers, so only the teardown can settle this. The
        // rejection is captured up front: it lands while dispose is still
        // running, before an `await` on the call would have a handler on it.
        const inFlight = session.sendRequest('slow', null).catch((error: unknown) => error);
        await new Promise((resolve) => setTimeout(resolve, 50));

        await harness.manager.dispose();

        await expect(inFlight).resolves.toMatchObject({
            name: 'LanguageServerRequestError',
            failure: 'closed',
            method: 'slow',
        });
        expect(isRunning(pid)).toBe(false);
        expect(harness.manager.size).toBe(0);
    });

    it('drops its listeners on shutdown: a later config change reaches nothing', async () => {
        const pidFile = pidPath();
        const harness = createHarness(() => echoDefinition(pidFile));
        const events: string[] = [];
        harness.manager.onSessionClosed((event) => events.push(event.reason));
        const { session } = harness.acquire('ws-a');
        await session.start();

        await harness.manager.dispose();
        expect(events).toEqual(['shutdown']);

        // Both listener sets are gone: the config subscription and the
        // session-closed fan-out. Neither may fire after shutdown.
        harness.setConfig('ws-a', [echoDefinition(pidFile, { id: 'other', command: process.execPath })]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(events).toEqual(['shutdown']);
        expect(harness.manager.size).toBe(0);
    });
});

// ============================================================================
// The bridge
// ============================================================================

describe('LanguageServerWebSocketServer teardown', () => {
    interface BridgeHarness {
        bridge: LanguageServerWebSocketServer;
        manager: LanguageServerManager;
        connect: () => Promise<{ socket: WebSocket; next: (type: string) => Promise<any>; send: (msg: unknown) => void }>;
    }

    async function createBridgeHarness(pidFile: string): Promise<BridgeHarness> {
        const dataDir = tempDir('coc-lsp-teardown-bridge-data-');
        const workspaceRoot = tempDir('coc-lsp-teardown-bridge-repo-');
        const write = writeLanguageServerConfig(dataDir, 'ws-a', {
            enabled: true,
            definitions: [echoDefinition(pidFile)],
        });
        expect(write.ok).toBe(true);
        const manager = new LanguageServerManager({ dataDir, startTimeoutMs: 10_000, requestTimeoutMs: 30_000 });
        const bridge = new LanguageServerWebSocketServer(
            { getWorkspaces: async () => [{ id: 'ws-a', rootPath: workspaceRoot }] } as never,
            manager,
        );
        const server = http.createServer();
        attachWebSocketUpgradeHandler(server, new ProcessWebSocketServer(), undefined, bridge);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        cleanups.push(async () => {
            bridge.closeAll();
            await manager.dispose();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        });

        const connect = async (): Promise<{
            socket: WebSocket;
            next: (type: string) => Promise<any>;
            send: (msg: unknown) => void;
        }> => {
            const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/language-server?workspaceId=ws-a&editingSessionId=session-1`);
            const received: LanguageServerServerMessage[] = [];
            let waiters: { type: string; resolve: (msg: any) => void }[] = [];
            socket.on('message', (raw: Buffer) => {
                const message = JSON.parse(raw.toString('utf-8')) as LanguageServerServerMessage;
                received.push(message);
                waiters = waiters.filter((waiter) => {
                    if (waiter.type !== message.type) {
                        return true;
                    }
                    waiter.resolve(message);
                    return false;
                });
            });
            await new Promise<void>((resolve, reject) => {
                socket.once('open', () => resolve());
                socket.once('error', reject);
            });
            cleanups.push(() => { socket.close(); });
            return {
                socket,
                send: (msg) => socket.send(JSON.stringify(msg)),
                next: (type) => {
                    const buffered = received.find((msg) => msg.type === type);
                    if (buffered) {
                        return Promise.resolve(buffered);
                    }
                    return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 15_000);
                        waiters.push({ type, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
                    });
                },
            };
        };
        return { bridge, manager, connect };
    }

    it('runs one heartbeat for every socket and clears it on closeAll', async () => {
        const started = vi.spyOn(globalThis, 'setInterval');
        const cleared = vi.spyOn(globalThis, 'clearInterval');
        const harness = await createBridgeHarness(pidPath());
        const first = await harness.connect();
        await first.next('lsp-welcome');
        const second = await harness.connect();
        await second.next('lsp-welcome');

        const heartbeats = started.mock.calls
            .map((call, index) => ({ delay: call[1], handle: started.mock.results[index].value }))
            .filter((entry) => entry.delay === HEARTBEAT_INTERVAL_MS);
        expect(heartbeats).toHaveLength(1);

        harness.bridge.closeAll();

        expect(cleared.mock.calls.map((call) => call[0])).toContain(heartbeats[0].handle);
        expect(harness.bridge.clientCount).toBe(0);
    });

    it('releases every session reference the sockets held', async () => {
        const pidFile = pidPath();
        const harness = await createBridgeHarness(pidFile);
        const client = await harness.connect();
        await client.next('lsp-welcome');
        client.send({ type: 'lsp-attach', requestId: 'r1', path: 'notes.txt' });
        const attached = await client.next('lsp-attached');
        const session = harness.manager.getSession(attached.sessionKey);
        await readPid(pidFile);
        await waitFor(() => session?.referenceCount === 1, 'the attachment to take a reference');

        harness.bridge.closeAll();

        expect(session?.referenceCount).toBe(0);
    });
});

// ============================================================================
// The composed server
// ============================================================================

describe('language-server teardown on a composed execution server', () => {
    function httpRequest(url: string, options: { method?: string; body?: string } = {}): Promise<{ status: number }> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const req = http.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port,
                    path: parsed.pathname + parsed.search,
                    method: options.method ?? 'GET',
                    headers: options.body ? { 'content-type': 'application/json' } : undefined,
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
                },
            );
            req.on('error', reject);
            if (options.body) {
                req.write(options.body);
            }
            req.end();
        });
    }

    /**
     * A running CoC with language support enabled for one workspace and one
     * document attached, i.e. exactly one fixture process alive.
     */
    async function startServerWithAttachedDocument(workspaceId: string): Promise<{
        url: string;
        pid: number;
        close: () => Promise<void>;
    }> {
        const dataDir = tempDir('coc-lsp-teardown-server-data-');
        const pidFile = pidPath();
        const write = writeLanguageServerConfig(dataDir, workspaceId, {
            enabled: true,
            definitions: [echoDefinition(pidFile)],
        });
        expect(write.ok).toBe(true);
        const workspaceRoot = tempDir('coc-lsp-teardown-server-repo-');
        fs.writeFileSync(path.join(workspaceRoot, 'notes.txt'), 'hello\n');

        const store = new FileProcessStore({ dataDir });
        const server = await createExecutionServer({ port: 0, host: '127.0.0.1', store, dataDir });
        let closed = false;
        const close = async (): Promise<void> => {
            if (closed) {
                return;
            }
            closed = true;
            await server.close();
        };
        cleanups.push(close);

        const registered = await httpRequest(`${server.url}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: workspaceId, name: 'LSP', rootPath: workspaceRoot }),
        });
        expect(registered.status).toBe(201);

        const socket = new WebSocket(
            `${server.url.replace('http://', 'ws://')}/ws/language-server?workspaceId=${workspaceId}&editingSessionId=session-1`,
        );
        cleanups.push(() => { socket.close(); });
        await new Promise<void>((resolve, reject) => {
            socket.once('open', () => resolve());
            socket.once('error', reject);
        });
        // The bridge registers its message handler only after it has read the
        // workspace list, so an attach sent before the welcome is lost.
        await new Promise<void>((resolve) => {
            socket.on('message', (raw: Buffer) => {
                if (JSON.parse(raw.toString('utf-8')).type === 'lsp-welcome') {
                    resolve();
                }
            });
        });
        socket.send(JSON.stringify({ type: 'lsp-attach', requestId: 'r1', path: 'notes.txt' }));
        const pid = await readPid(pidFile);
        return { url: server.url, pid, close };
    }

    it('kills the workspace’s language server when the workspace is deleted', async () => {
        const server = await startServerWithAttachedDocument('ws-teardown-1');
        expect(isRunning(server.pid)).toBe(true);

        const deleted = await httpRequest(`${server.url}/api/workspaces/ws-teardown-1`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);

        await waitFor(() => !isRunning(server.pid), 'the removed workspace’s process to exit');
    });

    it('kills every language server left running when CoC shuts down', async () => {
        const server = await startServerWithAttachedDocument('ws-teardown-2');
        expect(isRunning(server.pid)).toBe(true);

        await server.close();

        // The close handler awaits the language-server dispose, so by the time
        // it resolves there is nothing left to poll for.
        expect(isRunning(server.pid)).toBe(false);
    });
});
