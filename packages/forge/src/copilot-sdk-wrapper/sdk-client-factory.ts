/**
 * SDK Client Factory
 *
 * Isolates per-request CopilotClient spawning so it can be unit-tested and
 * mocked independently of CopilotSDKService.
 */

import * as fs from 'fs';
import { CopilotClient, type CopilotClientOptions } from '@github/copilot-sdk';
import { ensureFolderTrusted } from './trusted-folder';
import { getAIServiceLogger } from '../ai-logger';

/**
 * Spawn a new `CopilotClient`.
 *
 * Responsibilities:
 * - Validates the working directory exists (warns, but does not throw).
 * - Registers the directory as trusted (non-fatal if it fails).
 * - Constructs and returns a new `CopilotClient` instance.
 *
 * @param options - Client creation options (e.g. `cwd`).
 * @returns The newly created SDK client instance.
 */
export function createSdkClient(options: CopilotClientOptions = {}): CopilotClient {
    const { cwd } = options;
    const aiLog = getAIServiceLogger();
    const clientOptions: CopilotClientOptions = {};

    if (cwd) {
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

    aiLog.debug({ clientOptions }, 'Creating new CopilotClient');
    return new CopilotClient(clientOptions);
}
