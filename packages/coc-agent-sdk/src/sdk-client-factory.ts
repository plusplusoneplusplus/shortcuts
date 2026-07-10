/**
 * SDK Client Factory
 *
 * Isolates per-request CopilotClient spawning so it can be unit-tested and
 * mocked independently of CopilotSDKService.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { CopilotClient, CopilotClientOptions } from '@github/copilot-sdk';
import { ensureFolderTrusted } from './trusted-folder';
import { getAIServiceLogger } from './logger';
import { getCachedCopilotSdk } from './sdk-esm-loader';
import { preferUnpackedPath } from './asar-path';
import {
    resolveWorkspaceExecutionContext,
    translatePathForHostFilesystem,
} from './internal/workspace-execution';

/**
 * Walk up from `startDir` looking for `node_modules/@github/copilot/index.js`.
 * Returns the absolute path to `index.js` when found, or `undefined`.
 *
 * Only `@github/copilot` <= 1.0.61 ships `index.js`; newer versions are a thin
 * `npm-loader.js` plus a native platform binary — see
 * {@link findCopilotNativeCliPath}.
 */
export function findCopilotCliPath(startDir?: string): string | undefined {
    let dir = startDir ?? __dirname;
    while (true) {
        const candidate = path.join(dir, 'node_modules', '@github', 'copilot', 'index.js');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

/**
 * Walk up from `startDir` looking for the native Copilot CLI executable shipped
 * by the platform package `@github/copilot-<platform>-<arch>` (e.g.
 * `@github/copilot-darwin-arm64/copilot`). Returns the absolute executable path
 * when found, or `undefined`.
 */
export function findCopilotNativeCliPath(
    startDir?: string,
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
): string | undefined {
    const names = platform === 'win32' ? ['copilot.exe', 'copilot'] : ['copilot'];
    let dir = startDir ?? __dirname;
    while (true) {
        const pkgDir = path.join(dir, 'node_modules', '@github', `copilot-${platform}-${arch}`);
        for (const name of names) {
            const candidate = path.join(pkgDir, name);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

/**
 * How the Copilot CLI entry was resolved:
 * - `js`: `@github/copilot/index.js` (<= 1.0.61 layout) — must run under a Node
 *   runtime.
 * - `native`: the platform package's native executable (>= 1.0.62 layout, where
 *   `@github/copilot` is only a thin `npm-loader.js`) — spawned directly.
 *
 * Paths are rewritten to their `app.asar.unpacked` copy when applicable, since
 * neither a plain Node child nor an exec'd binary can load from inside asar.
 */
export interface CopilotCliResolution {
    kind: 'js' | 'native';
    path: string;
}

/**
 * Resolve the Copilot CLI entry, preferring the `index.js` layout (matches the
 * copilot-sdk's own bundled-CLI default) and falling back to the native
 * platform binary. Returns `undefined` when neither is installed.
 */
export function resolveCopilotCli(startDir?: string): CopilotCliResolution | undefined {
    const js = findCopilotCliPath(startDir);
    if (js) {
        return { kind: 'js', path: preferUnpackedPath(js) };
    }
    const native = findCopilotNativeCliPath(startDir);
    if (native) {
        return { kind: 'native', path: preferUnpackedPath(native) };
    }
    return undefined;
}

let cachedSystemNodePath: string | undefined | null = null;

/**
 * Resolve the system `node` binary to an absolute path. Required when running
 * under Electron because the copilot-sdk validates the path via `existsSync`.
 * The result is cached after the first lookup.
 */
export function resolveSystemNodePath(): string | undefined {
    if (cachedSystemNodePath !== null) return cachedSystemNodePath;
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const resolved = execFileSync(cmd, ['node'], { encoding: 'utf8', timeout: 5000 }).trim();
        if (resolved && fs.existsSync(resolved)) {
            cachedSystemNodePath = resolved;
            return resolved;
        }
    } catch { /* which/where failed */ }

    const candidates = process.platform === 'win32'
        ? ['C:\\Program Files\\nodejs\\node.exe']
        : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            cachedSystemNodePath = c;
            return c;
        }
    }
    cachedSystemNodePath = undefined;
    return undefined;
}

/** @internal Reset for testing */
export function resetSystemNodePathCache(): void { cachedSystemNodePath = null; }

/**
 * How CoC launches the Copilot CLI under Electron: which Node runtime runs which
 * CLI entry. Recorded on each client creation so packaged-desktop spawn failures
 * (e.g. the CLI rejecting an argument) are diagnosable from the surfaced error.
 */
export interface CopilotElectronSpawn {
    /**
     * Absolute path to the Node runtime that will run the CLI. For
     * `native-binary` mode there is no separate runtime — this equals
     * `cliPath` (the executable itself).
     */
    nodeRuntime: string;
    /** Absolute path to the Copilot CLI entry (`index.js` or native binary). */
    cliPath: string;
    /**
     * `system-node`: a real `node` was found on disk (preferred for the JS CLI).
     * `electron-node`: no system node found, so the Electron binary is run in
     * Node mode (`ELECTRON_RUN_AS_NODE=1`) instead — e.g. on an nvm-only machine
     * whose `node` is not on a GUI-launched app's PATH.
     * `native-binary`: the platform package's native executable is spawned
     * directly — no Node runtime involved (`@github/copilot` >= 1.0.62 layout).
     */
    mode: 'system-node' | 'electron-node' | 'native-binary';
}

/**
 * Decide the Node runtime for the Copilot CLI under Electron. Prefer a real
 * system `node`; when none is found, fall back to the Electron binary run in
 * Node mode rather than leaving the SDK to resolve an ambiguous bundled CLI
 * under the raw Electron binary. Pure — injectable for testing.
 */
export function resolveElectronCopilotSpawn(
    cliPath: string,
    systemNode: string | undefined,
    electronExecPath: string,
): CopilotElectronSpawn {
    return systemNode
        ? { nodeRuntime: systemNode, cliPath, mode: 'system-node' }
        : { nodeRuntime: electronExecPath, cliPath, mode: 'electron-node' };
}

/**
 * Build the `{ connection, env }` a `CopilotClient` needs to launch the CLI via
 * `<nodeRuntime> <cliPath> --headless …` under Electron. The env is a clean copy
 * of `baseEnv` with `ELECTRON_RUN_AS_NODE` stripped for a real system node, or
 * forced on so the Electron binary runs as Node. Pure — injectable for testing.
 */
export function buildElectronCopilotConnection<TConnection>(
    forStdio: (opts: { path: string; args: string[] }) => TConnection,
    cliPath: string,
    systemNode: string | undefined,
    electronExecPath: string,
    baseEnv: NodeJS.ProcessEnv,
): { connection: TConnection; env: Record<string, string>; spawn: CopilotElectronSpawn } {
    const spawn = resolveElectronCopilotSpawn(cliPath, systemNode, electronExecPath);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseEnv)) {
        if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') {
            env[k] = v;
        }
    }
    if (spawn.mode === 'electron-node') {
        env.ELECTRON_RUN_AS_NODE = '1';
    }
    return { connection: forStdio({ path: spawn.nodeRuntime, args: [spawn.cliPath] }), env, spawn };
}

/**
 * Build the `{ connection, env }` a `CopilotClient` needs to launch the native
 * Copilot CLI binary directly. The copilot-sdk spawns a non-`.js` stdio path
 * as the executable itself (appending its own `--headless …` args), so no Node
 * runtime is involved. The env is a clean copy of `baseEnv` with
 * `ELECTRON_RUN_AS_NODE` stripped so any grandchildren spawn normally.
 * Pure — injectable for testing.
 */
export function buildCopilotNativeConnection<TConnection>(
    forStdio: (opts: { path: string; args: string[] }) => TConnection,
    binPath: string,
    baseEnv: NodeJS.ProcessEnv,
): { connection: TConnection; env: Record<string, string>; spawn: CopilotElectronSpawn } {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseEnv)) {
        if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') {
            env[k] = v;
        }
    }
    return {
        connection: forStdio({ path: binPath, args: [] }),
        env,
        spawn: { nodeRuntime: binPath, cliPath: binPath, mode: 'native-binary' },
    };
}

let lastCopilotElectronSpawn: CopilotElectronSpawn | undefined;

/** The most recent Electron Copilot spawn resolution, for diagnostics. */
export function getLastCopilotElectronSpawn(): CopilotElectronSpawn | undefined {
    return lastCopilotElectronSpawn;
}

/**
 * Spawn a new `CopilotClient`.
 *
 * Responsibilities:
 * - Validates the working directory exists (warns, but does not throw).
 * - Registers the directory as trusted (non-fatal if it fails).
 * - Constructs and returns a new `CopilotClient` instance.
 *
 * Requires the SDK to have been loaded via `loadCopilotSdk()` before calling.
 *
 * @param options - Client creation options (e.g. `workingDirectory`).
 * @returns The newly created SDK client instance.
 */
export function createSdkClient(options: CopilotClientOptions = {}): CopilotClient {
    const { workingDirectory } = options;
    const aiLog = getAIServiceLogger();
    const clientOptions: CopilotClientOptions = { ...options };

    if (workingDirectory) {
        const executionContext = resolveWorkspaceExecutionContext(workingDirectory);
        if (executionContext.kind === 'wsl') {
            const hostWorkingDirectory = translatePathForHostFilesystem(workingDirectory, executionContext);
            if (!fs.existsSync(hostWorkingDirectory)) {
                aiLog.warn(
                    { workingDirectory, hostWorkingDirectory },
                    'Translated WSL working directory does not exist on the host filesystem. ' +
                    'The SDK will fail with ERR_STREAM_DESTROYED because child_process.spawn ' +
                    'requires an existing cwd. Ensure the caller passes a valid directory.',
                );
            }
            clientOptions.workingDirectory = hostWorkingDirectory;
            try {
                ensureFolderTrusted(hostWorkingDirectory);
            } catch {
                // Non-fatal: trust dialog will appear if this fails
            }
        } else {
            if (!fs.existsSync(workingDirectory)) {
                aiLog.warn(
                    { workingDirectory },
                    'Working directory does not exist. ' +
                    'The SDK will fail with ERR_STREAM_DESTROYED because child_process.spawn ' +
                    'requires an existing cwd. Ensure the caller passes a valid directory.',
                );
            }
            clientOptions.workingDirectory = workingDirectory;
            try {
                ensureFolderTrusted(workingDirectory);
            } catch {
                // Non-fatal: trust dialog will appear if this fails
            }
        }
    }

    const sdk = getCachedCopilotSdk();
    if (!sdk) throw new Error('Copilot SDK not loaded. Call loadCopilotSdk() first.');

    // In desktop mode the server runs under Electron Helper (ELECTRON_RUN_AS_NODE=1),
    // so process.execPath is the Electron binary. Left alone, the copilot-sdk
    // resolves its own bundled CLI and spawns it under that binary, which fails in
    // packaged builds. Override the connection so CoC controls both the runtime
    // and the CLI entry. The copilot-sdk validates the path with `existsSync`,
    // so the runtime and CLI must be absolute on-disk paths.
    //
    // `@github/copilot` >= 1.0.62 no longer ships `index.js` — only a thin
    // `npm-loader.js` plus a native platform binary. The copilot-sdk's own
    // bundled-CLI default requires `index.js`, so with the new layout it cannot
    // start the CLI under ANY runtime (Electron or plain Node). Spawn the
    // unpacked native binary directly in that case, everywhere.
    if (!clientOptions.connection) {
        const isElectron = Boolean((process.versions as Record<string, string | undefined>).electron);
        const resolution = resolveCopilotCli();
        if (resolution?.kind === 'js' && isElectron) {
            // Launch the CLI via `<node> index.js --headless …` (0 positional
            // args). Prefer a real system node; otherwise run the Electron binary
            // in Node mode. Never leave the SDK to resolve its own bundled CLI
            // under the raw Electron binary, which fails in packaged builds.
            const { connection, env, spawn } = buildElectronCopilotConnection(
                (opts) => sdk.RuntimeConnection.forStdio(opts),
                resolution.path,
                resolveSystemNodePath(),
                process.execPath,
                process.env,
            );
            clientOptions.connection = connection;
            clientOptions.env = env;
            lastCopilotElectronSpawn = spawn;
            aiLog.info(
                { nodeRuntime: spawn.nodeRuntime, copilotCliPath: spawn.cliPath, mode: spawn.mode },
                'Electron detected: launching copilot CLI via resolved node runtime',
            );
        } else if (resolution?.kind === 'native') {
            const { connection, env, spawn } = buildCopilotNativeConnection(
                (opts) => sdk.RuntimeConnection.forStdio(opts),
                resolution.path,
                process.env,
            );
            clientOptions.connection = connection;
            clientOptions.env = env;
            lastCopilotElectronSpawn = spawn;
            aiLog.info(
                { copilotCliPath: spawn.cliPath, mode: spawn.mode },
                'Launching copilot native CLI binary directly (no index.js in @github/copilot)',
            );
        } else if (isElectron && !resolution) {
            aiLog.warn(
                'Electron detected but no copilot CLI was found (neither @github/copilot/index.js nor the @github/copilot-<platform>-<arch> native binary).',
            );
        }
        // resolution?.kind === 'js' && !isElectron: leave the SDK default —
        // under plain Node it resolves and spawns index.js itself.
    }

    aiLog.debug({ clientOptions }, 'Creating new CopilotClient');
    return new sdk.CopilotClient(clientOptions);
}
