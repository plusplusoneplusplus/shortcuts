/**
 * CoC Desktop — server controller (AC-02).
 *
 * Implements the "attach-or-start" lifecycle for the embedded CoC server:
 *
 *   1. Probe `GET /api/health` on the well-known CLI port (4000). If a healthy
 *      server is already running (e.g. a `coc serve` launched from a terminal),
 *      ATTACH to it — record that we did not start it so we never shut it down.
 *   2. Otherwise pick a free ephemeral port (never the hardcoded 4000) and
 *      `fork()` `server-entry.js`, which runs as Electron's Node via
 *      `ELECTRON_RUN_AS_NODE` and boots `createExecutionServer()` against the
 *      shared `~/.coc` data dir. Wait for its `{ type: 'listening', port }`
 *      signal before resolving.
 *
 * This module deliberately imports NOTHING from `electron` so it can be unit
 * tested under plain Node/vitest. The real `fork`, `probeHealth`, and
 * `findFreePort` are injectable via {@link AttachOrStartOptions.deps}.
 */

import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { fork, ChildProcess } from 'child_process';
import { augmentPathWithBundledAgents } from './agent-bin-path';

/** Default loopback bind address — the server is never exposed off-box. */
export const DEFAULT_HOST = '127.0.0.1';

/** The well-known port a CLI `coc serve` binds by default (attach target). */
export const CLI_DEFAULT_PORT = 4000;

/** Default shared data dir — the same `~/.coc` the CLI uses. */
export function defaultDataDir(): string {
    return path.join(os.homedir(), '.coc');
}

/** A running (or attached) CoC server, as seen by the Electron main process. */
export interface ServerHandle {
    host: string;
    port: number;
    url: string;
    /** true → this process forked the server; false → we attached to an external one. */
    started: boolean;
    /** The forked child, present only when `started` is true. */
    child?: ChildProcess;
}

/** Injectable seams (overridden in tests). */
export interface AttachOrStartDeps {
    probeHealth?: (host: string, port: number, timeoutMs?: number) => Promise<boolean>;
    findFreePort?: (host: string) => Promise<number>;
    fork?: (modulePath: string, env: NodeJS.ProcessEnv) => ChildProcess;
}

export interface AttachOrStartOptions {
    /** Shared data dir handed to the forked server (default `~/.coc`). */
    dataDir?: string;
    /** Bind address (default `127.0.0.1`). */
    host?: string;
    /** Port probed to detect an already-running CLI server (default `4000`). */
    attachPort?: number;
    /** Path to the compiled `server-entry.js` (default next to this file). */
    serverEntryPath?: string;
    /** How long to wait for the forked server to report `listening` (default 30s). */
    startTimeoutMs?: number;
    deps?: AttachOrStartDeps;
}

/** Build a browser-loadable URL, bracketing IPv6 hosts like the server does. */
export function formatUrl(host: string, port: number): string {
    const hostForUrl = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const needsBrackets = hostForUrl.includes(':') && !hostForUrl.startsWith('[');
    return `http://${needsBrackets ? `[${hostForUrl}]` : hostForUrl}:${port}`;
}

/**
 * Resolve true iff a CoC server answers `GET /api/health` with `{status:'ok'}`.
 * Any connection error, non-200 status, timeout, or unparseable body → false.
 */
export function probeHealth(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get({ host, port, path: '/api/health', timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                resolve(false);
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve((JSON.parse(body) as { status?: string })?.status === 'ok');
                } catch {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

/** Acquire a free ephemeral port by binding to port 0 and reading it back. */
export function findFreePort(host: string = DEFAULT_HOST): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, host, () => {
            const addr = srv.address();
            if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
                const acquired = addr.port;
                srv.close(() => resolve(acquired));
            } else {
                srv.close(() => reject(new Error('Failed to acquire a free port')));
            }
        });
    });
}

/** Default fork: spawn `server-entry.js` as Electron's Node (`ELECTRON_RUN_AS_NODE`). */
function defaultFork(modulePath: string, env: NodeJS.ProcessEnv): ChildProcess {
    const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
    // Prepend the bundled agent-CLI directories so the server resolves the
    // shipped `copilot`/`codex`/`claude` even when the host PATH lacks them
    // (best-effort; leaves PATH unchanged when nothing bundled resolves).
    merged.PATH = augmentPathWithBundledAgents({}, merged.PATH);
    return fork(modulePath, [], {
        env: merged,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
}

/** Resolve with the port the child actually bound once it signals `listening`. */
function waitForListening(child: ChildProcess, timeoutMs: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            child.removeListener('message', onMessage);
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
        };
        const finish = (fn: () => void) => {
            if (settled) { return; }
            settled = true;
            cleanup();
            fn();
        };
        const onMessage = (msg: unknown) => {
            if (!msg || typeof msg !== 'object') { return; }
            const m = msg as { type?: string; port?: number; message?: string };
            if (m.type === 'listening' && typeof m.port === 'number') {
                finish(() => resolve(m.port as number));
            } else if (m.type === 'error') {
                finish(() => reject(new Error(m.message || 'server-entry reported an error')));
            }
        };
        const onError = (err: Error) => finish(() => reject(err));
        const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
            finish(() => reject(new Error(`server-entry exited before listening (code=${code}, signal=${signal})`)));
        const timer = setTimeout(
            () => finish(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for server-entry to listen`))),
            timeoutMs,
        );
        timer.unref();
        child.on('message', onMessage);
        child.on('error', onError);
        child.on('exit', onExit);
    });
}

/**
 * Attach to an already-running CoC server, or start our own forked one.
 * See the module header for the full lifecycle.
 */
export async function attachOrStart(options: AttachOrStartOptions = {}): Promise<ServerHandle> {
    const host = options.host ?? DEFAULT_HOST;
    const dataDir = options.dataDir ?? defaultDataDir();
    const attachPort = options.attachPort ?? CLI_DEFAULT_PORT;
    const startTimeoutMs = options.startTimeoutMs ?? 30_000;
    const serverEntryPath = options.serverEntryPath ?? path.join(__dirname, 'server-entry.js');

    const deps = options.deps ?? {};
    const probe = deps.probeHealth ?? probeHealth;
    const findPort = deps.findFreePort ?? findFreePort;
    const forkFn = deps.fork ?? defaultFork;

    // 1) Attach if a healthy server is already listening on the CLI port.
    if (await probe(host, attachPort)) {
        return { host, port: attachPort, url: formatUrl(host, attachPort), started: false };
    }

    // 2) Otherwise pick a free ephemeral port and fork our own server.
    const requestedPort = await findPort(host);
    const child = forkFn(serverEntryPath, {
        ELECTRON_RUN_AS_NODE: '1',
        COC_DESKTOP_HOST: host,
        COC_DESKTOP_PORT: String(requestedPort),
        COC_DESKTOP_DATA_DIR: dataDir,
    });

    let listeningPort: number;
    try {
        listeningPort = await waitForListening(child, startTimeoutMs);
    } catch (err) {
        // Don't leave an orphaned child behind on a failed start.
        try { child.kill(); } catch { /* best-effort */ }
        throw err;
    }

    return { host, port: listeningPort, url: formatUrl(host, listeningPort), started: true, child };
}
