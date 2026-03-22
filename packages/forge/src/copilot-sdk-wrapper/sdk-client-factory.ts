/**
 * SDK Client Factory
 *
 * Isolates per-request CopilotClient spawning so it can be unit-tested and
 * mocked independently of CopilotSDKService.
 */

import * as fs from 'fs';
import { SdkModule } from './sdk-loader';
import { ensureFolderTrusted } from './trusted-folder';
import { getAIServiceLogger } from '../ai-logger';

/**
 * Options passed to the SDK client constructor.
 * Currently the only supported option is `cwd` (working directory for the CLI
 * child process spawned by the SDK).
 */
export interface ClientOptions {
    /** Working directory for the SDK CLI child process. */
    cwd?: string;
}

/**
 * Spawn a new `CopilotClient` from the given SDK module.
 *
 * Responsibilities:
 * - Validates the working directory exists (warns, but does not throw).
 * - Registers the directory as trusted (non-fatal if it fails).
 * - Constructs and returns a new `sdkModule.CopilotClient` instance.
 *
 * This function has no dependency on `CopilotSDKService`; it receives the
 * already-loaded `sdkModule` as a parameter so callers control loading.
 *
 * @param sdkModule - Loaded SDK module (as returned by `loadSdk()`).
 * @param options   - Client creation options (e.g. `cwd`).
 * @returns The newly created SDK client instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSdkClient(sdkModule: SdkModule, options: ClientOptions = {}): any {
    const { cwd } = options;
    const aiLog = getAIServiceLogger();
    const clientOptions: ClientOptions = {};

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
    return new sdkModule.CopilotClient(clientOptions);
}
