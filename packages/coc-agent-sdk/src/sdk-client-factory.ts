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
import {
    resolveWorkspaceExecutionContext,
    translatePathForHostFilesystem,
} from './internal/workspace-execution';

/**
 * Walk up from `startDir` looking for `node_modules/@github/copilot/index.js`.
 * Returns the absolute path to `index.js` when found, or `undefined`.
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
    // so process.execPath is the Electron binary. The copilot-sdk spawns the CLI via
    // `spawn(process.execPath, [cliPath, ...])` which would use the Electron binary.
    // Override the connection to use the system `node` binary (absolute path) instead.
    // The copilot-sdk validates the path with `existsSync`, so a bare `'node'` fails.
    if (
        (process.versions as Record<string, string | undefined>).electron &&
        !clientOptions.connection
    ) {
        const copilotCliPath = findCopilotCliPath();
        const systemNode = resolveSystemNodePath();
        if (copilotCliPath && systemNode) {
            clientOptions.connection = sdk.RuntimeConnection.forStdio({
                path: systemNode,
                args: [copilotCliPath],
            });
            // Strip Electron-specific env vars so the spawned child is a clean node process.
            const cleanEnv: Record<string, string> = {};
            for (const [k, v] of Object.entries(process.env)) {
                if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') {
                    cleanEnv[k] = v;
                }
            }
            clientOptions.env = cleanEnv;
            aiLog.debug({ copilotCliPath, systemNode }, 'Electron detected: overriding copilot CLI connection to use system node');
        } else if (copilotCliPath) {
            aiLog.warn(
                { copilotCliPath },
                'Electron detected but system node binary not found. Copilot SDK will use Electron binary which may fail.',
            );
        }
    }

    aiLog.debug({ clientOptions }, 'Creating new CopilotClient');
    return new sdk.CopilotClient(clientOptions);
}
