/**
 * SDK Client Factory
 *
 * Isolates per-request CopilotClient spawning so it can be unit-tested and
 * mocked independently of CopilotSDKService.
 */

import * as fs from 'fs';
import type { CopilotClient, CopilotClientOptions } from '@github/copilot-sdk';
import { ensureFolderTrusted } from './trusted-folder';
import { getAIServiceLogger } from './logger';
import { getCachedCopilotSdk } from './sdk-esm-loader';
import {
    resolveWorkspaceExecutionContext,
    translatePathForHostFilesystem,
} from './internal/workspace-execution';

/**
 * Options for {@link createSdkClient}.
 *
 * Mirrors {@link CopilotClientOptions} but takes the working directory as `cwd`
 * (the term used throughout this codebase). The factory WSL-translates it and
 * forwards it to the SDK as {@link CopilotClientOptions.workingDirectory}
 * (the SDK dropped the `cwd` alias in v1.0.0).
 */
export type CreateSdkClientOptions = Omit<CopilotClientOptions, 'workingDirectory'> & {
    /** Working directory for the runtime; mapped to `CopilotClientOptions.workingDirectory`. */
    cwd?: string;
};

/**
 * Spawn a new `CopilotClient`.
 *
 * Responsibilities:
 * - Validates the working directory exists (warns, but does not throw).
 * - Registers the directory as trusted (non-fatal if it fails).
 * - Maps `cwd` onto the SDK's `workingDirectory` client option.
 * - Constructs and returns a new `CopilotClient` instance.
 *
 * Requires the SDK to have been loaded via `loadCopilotSdk()` before calling.
 *
 * @param options - Client creation options (e.g. `cwd`).
 * @returns The newly created SDK client instance.
 */
export function createSdkClient(options: CreateSdkClientOptions = {}): CopilotClient {
    const { cwd, ...rest } = options;
    const aiLog = getAIServiceLogger();
    const clientOptions: CopilotClientOptions = { ...rest };

    if (cwd) {
        const executionContext = resolveWorkspaceExecutionContext(cwd);
        if (executionContext.kind === 'wsl') {
            const hostWorkingDirectory = translatePathForHostFilesystem(cwd, executionContext);
            if (!fs.existsSync(hostWorkingDirectory)) {
                aiLog.warn(
                    { cwd, hostWorkingDirectory },
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
            if (!fs.existsSync(cwd)) {
                aiLog.warn(
                    { cwd },
                    'Working directory does not exist. ' +
                    'The SDK will fail with ERR_STREAM_DESTROYED because child_process.spawn ' +
                    'requires an existing cwd. Ensure the caller passes a valid directory.',
                );
            }
            clientOptions.workingDirectory = cwd;
            try {
                ensureFolderTrusted(cwd);
            } catch {
                // Non-fatal: trust dialog will appear if this fails
            }
        }
    }

    const sdk = getCachedCopilotSdk();
    if (!sdk) throw new Error('Copilot SDK not loaded. Call loadCopilotSdk() first.');
    aiLog.debug({ clientOptions }, 'Creating new CopilotClient');
    return new sdk.CopilotClient(clientOptions);
}
