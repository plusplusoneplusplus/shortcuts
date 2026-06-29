/**
 * CoC Desktop — forked server entry (AC-02).
 *
 * Runs in a child process spawned by the Electron main process. Because the
 * child is forked with `ELECTRON_RUN_AS_NODE=1`, Electron's own binary executes
 * this file as plain Node — which is what lets the native modules
 * (`better-sqlite3`, `node-pty`) load against Electron's ABI (AC-04).
 *
 * It boots the prebuilt CoC server verbatim:
 *   - `createExecutionServer({ port, host, dataDir, store, fileConfig })`
 *   - a real file/SQLite-backed store via `createProcessStore`, so the desktop
 *     app shares the same `~/.coc` data the CLI uses.
 *
 * Communication with the parent is over the IPC channel:
 *   - child → parent: `{ type: 'listening', port }` once bound, or
 *     `{ type: 'error', message }` on boot failure.
 *   - parent → child: `{ type: 'shutdown', drain? }` to close gracefully
 *     (used by the quit/lifecycle handling in AC-05).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Minimal structural types for the prebuilt CoC server surface. We require the
// compiled JS lazily (below) rather than importing the full type graph, keeping
// this entry decoupled from the coc package's declaration layout.
interface CocServerHandle {
    port: number;
    host: string;
    url: string;
    close: (options?: { drain?: boolean; drainTimeoutMs?: number }) => Promise<unknown>;
}
type CreateExecutionServer = (options: {
    port?: number;
    host?: string;
    dataDir?: string;
    store?: unknown;
    fileConfig?: unknown;
}) => Promise<CocServerHandle>;
type CreateProcessStore = (dataDir: string, backend?: 'file' | 'sqlite') => unknown;
type LoadConfigFile = () => { store?: { backend?: 'file' | 'sqlite' } } | undefined;

type ChildMessage =
    | { type: 'listening'; port: number }
    | { type: 'error'; message: string };

function send(message: ChildMessage): void {
    if (typeof process.send === 'function') {
        process.send(message);
    }
}

async function main(): Promise<void> {
    const host = process.env.COC_DESKTOP_HOST || '127.0.0.1';
    const port = Number(process.env.COC_DESKTOP_PORT) || 0;
    const dataDir = process.env.COC_DESKTOP_DATA_DIR || path.join(os.homedir(), '.coc');

    // The SQLite store opens `<dataDir>/processes.db` on construction, so the
    // data dir must exist first — mirror what the CLI `serve` command does.
    fs.mkdirSync(dataDir, { recursive: true });

    // Required lazily so this module stays importable without the coc runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createExecutionServer } = require('@plusplusoneplusplus/coc/dist/server') as {
        createExecutionServer: CreateExecutionServer;
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createProcessStore, loadConfigFile } = require('@plusplusoneplusplus/coc/dist/config') as {
        createProcessStore: CreateProcessStore;
        loadConfigFile: LoadConfigFile;
    };

    const fileConfig = loadConfigFile();
    const store = createProcessStore(dataDir, fileConfig?.store?.backend);

    const server = await createExecutionServer({ port, host, dataDir, store, fileConfig });

    send({ type: 'listening', port: server.port });

    let closing = false;
    const shutdown = async (drain: boolean) => {
        if (closing) { return; }
        closing = true;
        try {
            // AC-05: the desktop main process drives the started-vs-attached
            // choice; when it asks us to drain, gracefully flush in-flight work.
            if (drain) {
                await server.close({ drain: true });
            } else {
                await server.close();
            }
        } catch {
            /* best-effort */
        }
        process.exit(0);
    };

    // Parent asks us to wind down (AC-05 drives the started-vs-attached choice).
    process.on('message', (msg: unknown) => {
        if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'shutdown') {
            void shutdown(Boolean((msg as { drain?: boolean }).drain));
        }
    });
    // If the parent dies or the IPC channel drops, don't linger as an orphan.
    process.on('disconnect', () => { void shutdown(false); });
    process.on('SIGTERM', () => { void shutdown(false); });
    process.on('SIGINT', () => { void shutdown(false); });
}

main().catch((err: unknown) => {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
});
