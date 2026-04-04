/**
 * SDK Client Factory
 *
 * Isolates per-request CopilotClient spawning so it can be unit-tested and
 * mocked independently of CopilotSDKService.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CopilotClient, CopilotClientOptions } from '@github/copilot-sdk';
import { ensureFolderTrusted, getCopilotConfigDir } from './trusted-folder';
import { getAIServiceLogger } from '../ai-logger';
import { getCachedCopilotSdk } from './sdk-esm-loader';
import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
} from '../utils/workspace-execution';
import { windowsPathToWslPath } from '../utils/path-utils';

function wslConfigEnvironment(existingEnv: Record<string, string | undefined> | undefined): Record<string, string | undefined> {
    const configDir = getCopilotConfigDir();
    const translatedConfigDir = windowsPathToWslPath(path.resolve(configDir));
    if (!translatedConfigDir) {
        return existingEnv ?? {};
    }

    return {
        ...existingEnv,
        COPILOT_HOME: translatedConfigDir,
        XDG_CONFIG_HOME: translatedConfigDir,
    };
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
 * @param options - Client creation options (e.g. `cwd`).
 * @returns The newly created SDK client instance.
 */
export function createSdkClient(options: CopilotClientOptions = {}): CopilotClient {
    const { cwd } = options;
    const aiLog = getAIServiceLogger();
    const clientOptions: CopilotClientOptions = { ...options };

    if (cwd) {
        const executionContext = resolveWorkspaceExecutionContext(cwd);
        if (executionContext.kind === 'wsl') {
            clientOptions.cliPath = getWslExecutablePath();
            clientOptions.cliArgs = buildWslCommandArgs(executionContext, [process.env['COPILOT_WSL_CLI_COMMAND'] || 'copilot']);
            clientOptions.cwd = undefined;
            clientOptions.env = wslConfigEnvironment(options.env);
            try {
                ensureFolderTrusted(executionContext.linuxWorkingDirectory);
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
            clientOptions.cwd = cwd;
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
