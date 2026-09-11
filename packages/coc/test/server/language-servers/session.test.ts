/**
 * Process lifecycle for a language-server session: spawn from a structured
 * command vector, the initialize handshake, the concise status set, restart
 * backoff after a crash, and disposal after the idle interval.
 *
 * Every case runs against the real non-TypeScript fixture process, so a pass
 * here proves the lifecycle carries no language-specific behavior.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerSessionState } from '../../../src/server/language-servers/session';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');

const sessions: LanguageServerSession[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.dispose()));
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-session-'));
    tempDirs.push(dir);
    return dir;
}

function fixtureDefinition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'echo',
        displayName: 'Echo Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: process.execPath,
        args: [FIXTURE_SERVER],
        rootMarkers: ['package.json'],
        ...overrides,
    };
}

function createSession(
    definition: LanguageServerDefinition,
    options: Partial<ConstructorParameters<typeof LanguageServerSession>[0]> = {},
): { session: LanguageServerSession; states: LanguageServerSessionState[]; errors: Error[] } {
    const states: LanguageServerSessionState[] = [];
    const errors: Error[] = [];
    const session = new LanguageServerSession({
        definition,
        rootPath: options.rootPath ?? tempRoot(),
        requestTimeoutMs: 5_000,
        startTimeoutMs: 5_000,
        ...options,
        onStateChange: (state) => states.push(state),
        onError: (error) => errors.push(error),
    });
    sessions.push(session);
    return { session, states, errors };
}

/** Polls until `check` holds, so tests never depend on a fixed sleep. */
async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('LanguageServerSession startup', () => {
    it('spawns the definition command and completes the initialize handshake', async () => {
        const root = tempRoot();
        const { session, states } = createSession(
            fixtureDefinition({ initializationOptions: { flavor: 'generic' } }),
            { rootPath: root },
        );
        expect(session.status).toBe('disabled');

        await session.start();

        expect(session.status).toBe('ready');
        expect(session.isReady).toBe(true);
        expect(session.getState().serverName).toBe('echo-language-server');
        expect(session.getState().serverVersion).toBe('1.0.0');
        expect(session.getState().capabilities?.hoverProvider).toBe(true);
        expect(states.map((state) => state.status)).toEqual(['starting', 'ready']);
    });

    it('sends the resolved root as a file URI and forwards initializationOptions', async () => {
        const root = tempRoot();
        const { session } = createSession(fixtureDefinition({ initializationOptions: { flavor: 'generic' } }), {
            rootPath: root,
        });
        await session.start();

        const init = await session.sendRequest<{
            params: {
                rootUri: string;
                workspaceFolders: { uri: string; name: string }[];
                initializationOptions: unknown;
            };
            cwd: string;
        }>('getInit');

        const expectedUri = pathToFileURL(path.resolve(root)).href;
        expect(init.params.rootUri).toBe(expectedUri);
        expect(init.params.workspaceFolders).toEqual([{ uri: expectedUri, name: path.basename(root) }]);
        expect(init.params.initializationOptions).toEqual({ flavor: 'generic' });
        // The process runs in the project root, not CoC's working directory.
        expect(fs.realpathSync(init.cwd)).toBe(fs.realpathSync(root));
    });

    it('is idempotent: concurrent starts share one process', async () => {
        const { session, states } = createSession(fixtureDefinition());
        await Promise.all([session.start(), session.start(), session.start()]);
        expect(session.status).toBe('ready');
        expect(states.filter((state) => state.status === 'starting')).toHaveLength(1);
    });

    it('refuses to start a disabled definition and reports the disabled status', async () => {
        const { session } = createSession(fixtureDefinition({ enabled: false }));
        await expect(session.start()).rejects.toThrow(/disabled/);
        expect(session.status).toBe('disabled');
        expect(session.getState().detail).toMatch(/settings/);
    });

    it('reports unavailable, not failed, when the executable is missing', async () => {
        const { session } = createSession(
            fixtureDefinition({ command: 'coc-language-server-that-does-not-exist', args: [] }),
            { startTimeoutMs: 2_000 },
        );
        await expect(session.start()).rejects.toThrow();
        await waitFor(() => session.status !== 'starting');
        expect(session.status).toBe('unavailable');
        expect(session.getState().detail).toContain('coc-language-server-that-does-not-exist');
    });

    it('names the executable by its label, so a resolved host path stays off the status', async () => {
        const { session } = createSession(
            fixtureDefinition({
                command: path.join(path.sep, 'opt', 'coc-private', 'missing-language-server'),
                args: [],
            }),
            { startTimeoutMs: 2_000, commandLabel: 'typescript-language-server' },
        );
        await expect(session.start()).rejects.toThrow();
        await waitFor(() => session.status !== 'starting');
        expect(session.status).toBe('unavailable');
        expect(session.getState().detail).toBe('Executable not found: typescript-language-server');
    });

    it('includes adapter install guidance when the executable is unavailable', async () => {
        const { session } = createSession(
            fixtureDefinition({ command: 'coc-language-server-that-does-not-exist', args: [] }),
            {
                startTimeoutMs: 2_000,
                commandLabel: 'rust-analyzer',
                unavailableDetail: 'Install with: rustup component add rust-analyzer',
            },
        );
        await expect(session.start()).rejects.toThrow();
        await waitFor(() => session.status !== 'starting');
        expect(session.getState()).toMatchObject({
            status: 'unavailable',
            detail: 'Executable not found: rust-analyzer. Install with: rustup component add rust-analyzer',
        });
    });

    it('reports the resolved runtime in the state from the first status onwards', () => {
        const { session } = createSession(fixtureDefinition(), {
            runtimeLabel: 'Server: workspace \u00b7 TypeScript 5.9.2: workspace',
        });
        expect(session.getState().runtime).toBe('Server: workspace \u00b7 TypeScript 5.9.2: workspace');
    });

    it('fails when the process starts but never answers initialize', async () => {
        // A process that reads stdin forever and writes nothing back.
        const root = tempRoot();
        const { session } = createSession(
            fixtureDefinition({ command: process.execPath, args: ['-e', 'process.stdin.resume()'] }),
            { rootPath: root, startTimeoutMs: 250 },
        );
        await expect(session.start()).rejects.toThrow();
        expect(session.status).toBe('failed');
        expect(session.getState().detail).toMatch(/Handshake failed/);
        // A failed handshake must not leave a process holding the workspace.
        expect(() => fs.rmSync(root, { recursive: true, force: true })).not.toThrow();
    });
});

describe('LanguageServerSession requests and notifications', () => {
    it('starts the server on demand for the first request', async () => {
        const { session } = createSession(fixtureDefinition());
        await expect(session.sendRequest('echo', { hello: 'world' })).resolves.toEqual({ hello: 'world' });
        expect(session.status).toBe('ready');
    });

    it('delivers server notifications to subscribers registered before start', async () => {
        const { session } = createSession(fixtureDefinition());
        const published: unknown[] = [];
        session.onNotification('textDocument/publishDiagnostics', (params) => published.push(params));

        await session.start();
        session.sendNotification('textDocument/didOpen', {
            textDocument: { uri: 'file:///tmp/a.txt', languageId: 'plaintext', version: 1, text: 'hi' },
        });

        await waitFor(() => published.length > 0);
        expect(published[0]).toMatchObject({ uri: 'file:///tmp/a.txt' });
    });

    it('answers server-to-client requests through a handler that survives registration order', async () => {
        const { session } = createSession(fixtureDefinition());
        session.onRequest('window/showMessageRequest', () => ({ title: 'Retry' }));
        await expect(session.sendRequest('askClient', { message: 'pick' })).resolves.toEqual({ title: 'Retry' });
    });

    it('reports false for a notification sent while nothing is running', () => {
        const { session } = createSession(fixtureDefinition());
        expect(session.sendNotification('textDocument/didOpen', {})).toBe(false);
    });
});

describe('LanguageServerSession crash recovery', () => {
    it('restarts a crashed server while a reference is held and replays through onReady', async () => {
        const { session } = createSession(fixtureDefinition(), { restartBackoffMs: 10, maxRestarts: 3 });
        const readyCount: number[] = [];
        session.onReady(() => readyCount.push(Date.now()));
        const release = session.attach();
        await session.start();
        expect(readyCount).toHaveLength(1);

        session.sendNotification('crash');

        await waitFor(() => session.status === 'ready' && readyCount.length === 2);
        expect(session.getState().restarts).toBe(0);
        await expect(session.sendRequest('echo', { after: 'restart' })).resolves.toEqual({ after: 'restart' });
        release();
    });

    it('gives up after the restart budget and leaves a failed state a retry can clear', async () => {
        // A server that dies immediately can never hand back a ready session.
        const { session } = createSession(
            fixtureDefinition({ command: process.execPath, args: ['-e', 'process.exit(3)'] }),
            { restartBackoffMs: 5, maxRestarts: 1, startTimeoutMs: 1_000 },
        );
        session.attach();
        await expect(session.start()).rejects.toThrow();
        await waitFor(() => session.status === 'failed', 10_000);
        expect(session.getState().detail).toMatch(/did not recover|Handshake failed/);
    });

    it('does not restart a server that exits once nothing references it', async () => {
        const { session } = createSession(fixtureDefinition(), { restartBackoffMs: 5 });
        await session.start();
        session.sendNotification('crash');

        await waitFor(() => session.status === 'disabled');
        expect(session.getState().detail).toMatch(/stopped/i);
        // Nothing restarted behind our back.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(session.status).toBe('disabled');
    });

    it('counts a generation for every process the browser has to replay into', async () => {
        // The browser keeps its attachment across a crash, so the handshake
        // count is its only cue that the process behind the document is new.
        const { session } = createSession(fixtureDefinition(), { restartBackoffMs: 10, maxRestarts: 3 });
        expect(session.getState().generation).toBe(0);

        const release = session.attach();
        await session.start();
        expect(session.getState().generation).toBe(1);

        await session.restart();
        expect(session.getState().generation).toBe(2);

        session.sendNotification('crash');
        await waitFor(() => session.status === 'ready' && session.getState().generation === 3);
        release();
    });

    it('leaves the generation alone when a start fails', async () => {
        const { session } = createSession(
            fixtureDefinition({ command: process.execPath, args: ['-e', 'process.exit(3)'] }),
            { restartBackoffMs: 5, maxRestarts: 0, startTimeoutMs: 1_000 },
        );

        await expect(session.start()).rejects.toThrow();

        expect(session.getState().generation).toBe(0);
    });

    it('restart() clears the backoff budget and brings the server back', async () => {
        const { session } = createSession(fixtureDefinition());
        await session.start();
        const first = session.getState().serverName;

        await session.restart();

        expect(session.status).toBe('ready');
        expect(session.getState().serverName).toBe(first);
        await expect(session.sendRequest('echo', { n: 1 })).resolves.toEqual({ n: 1 });
    });

    it('reports every state transition to onStateChange subscribers', async () => {
        // `starting`, `reconnecting` and `failed` have no handler of their own,
        // so without this subscription an editor status display could only ever
        // show `ready`.
        const { session } = createSession(fixtureDefinition());
        const seen: string[] = [];
        const unsubscribe = session.onStateChange((state) => seen.push(state.status));

        await session.start();
        expect(seen).toEqual(['starting', 'ready']);
        // The connection is live by the time `ready` is announced, so a
        // subscriber may send on it from the notification it just received.
        expect(session.isReady).toBe(true);

        await session.restart();
        expect(seen).toEqual(['starting', 'ready', 'disabled', 'starting', 'ready']);

        unsubscribe();
        await session.stop();
        expect(seen).toHaveLength(5);
    });

    it('keeps reporting state to the remaining subscribers when one throws', async () => {
        const { session, errors } = createSession(fixtureDefinition());
        session.onStateChange(() => { throw new Error('status display exploded'); });
        const seen: string[] = [];
        session.onStateChange((state) => seen.push(state.status));

        await session.start();

        expect(seen).toEqual(['starting', 'ready']);
        expect(errors.map((error) => error.message)).toContain('status display exploded');
    });
});

describe('LanguageServerSession reference counting and disposal', () => {
    it('keeps the process while referenced and stops it after the idle interval', async () => {
        const { session } = createSession(fixtureDefinition(), { idleTimeoutMs: 20 });
        const releaseA = session.attach();
        const releaseB = session.attach();
        await session.start();
        expect(session.referenceCount).toBe(2);

        releaseA();
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(session.status).toBe('ready');

        releaseB();
        await waitFor(() => session.status === 'disabled');
        expect(session.getState().detail).toMatch(/idle/i);
    });

    it('cancels a pending idle stop when a new reference arrives', async () => {
        const { session } = createSession(fixtureDefinition(), { idleTimeoutMs: 30 });
        const release = session.attach();
        await session.start();
        release();
        const second = session.attach();

        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(session.status).toBe('ready');
        second();
    });

    it('releasing the same reference twice does not double-decrement', async () => {
        const { session } = createSession(fixtureDefinition(), { idleTimeoutMs: 10_000 });
        const release = session.attach();
        session.attach();
        release();
        release();
        expect(session.referenceCount).toBe(1);
    });

    it('dispose stops the process, rejects pending work, and refuses to restart', async () => {
        const { session } = createSession(fixtureDefinition());
        await session.start();
        const pending = session.sendRequest('slow', {}).catch((error: Error) => error);
        await waitFor(() => session.getState().status === 'ready');

        await session.dispose();

        await expect(pending).resolves.toBeInstanceOf(Error);
        expect(session.isDisposed).toBe(true);
        expect(session.status).toBe('disabled');
        await expect(session.start()).rejects.toThrow(/disposed/);
    });

    it('keeps the new process alive when the previous one exits late after a restart', async () => {
        // Regression: the exit handler was shared across processes, so the old
        // child's `exit` disposed the connection its successor already owned.
        const { session } = createSession(fixtureDefinition());
        await session.start();
        await session.restart();
        await session.restart();

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(session.status).toBe('ready');
        await expect(session.sendRequest('echo', { alive: true })).resolves.toEqual({ alive: true });
    });

    it('stop leaves the session reusable', async () => {
        const { session } = createSession(fixtureDefinition());
        await session.start();
        await session.stop();
        expect(session.status).toBe('disabled');

        await session.start();
        expect(session.status).toBe('ready');
    });
});
