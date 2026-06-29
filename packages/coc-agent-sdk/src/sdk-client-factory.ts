/**
 * SDK Client Factory
 *
 * Isolates per-request CopilotClient spawning so it can be unit-tested and
 * mocked independently of CopilotSDKService.
 */

import * as fs from 'fs';
import * as path from 'path';
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
    // so process.execPath is the Electron binary. Spawning the copilot CLI through it
    // causes an extra argv entry that Commander.js rejects as "too many arguments".
    // Override the connection to use the system `node` binary instead.
    if (
        (process.versions as Record<string, string | undefined>).electron &&
        !clientOptions.connection
    ) {
        const copilotCliPath = findCopilotCliPath();
        if (copilotCliPath) {
            clientOptions.connection = sdk.RuntimeConnection.forStdio({
                path: 'node',
                args: [copilotCliPath],
            });
            aiLog.debug({ copilotCliPath }, 'Electron detected: overriding copilot CLI connection to use system node');
        }
    }

    aiLog.debug({ clientOptions }, 'Creating new CopilotClient');
    return new sdk.CopilotClient(clientOptions);
}
