import { withOwnerToolRuntime, type OwnerScriptTools } from '../executors/owner-script-runner';
import { runJobGate } from './job-gate-runner';

export type JobGateOwnerTools = OwnerScriptTools;

/** One gate evaluation for a Sentinel owner; the runtime resolves the owner's tools. */
export interface JobGateRunRequest {
    workspaceId: string;
    processId: string;
    code: string;
    state: unknown;
    signal?: AbortSignal;
}

/** Owner-scoped gate execution supplied by the queue runtime. No provider turn starts. */
export type JobGateOwnerRunner = (request: JobGateRunRequest) => Promise<unknown>;

/**
 * Runs with the owner's resolved chat capabilities, including tools that ordinary
 * chat scripts omit. The caller validates live flags, owner and job revision,
 * supplies owner-bound capabilities, and cancels on revocation or shutdown.
 * No provider session is started: only the CoC handlers in this context execute.
 */
export async function runJobGateWithOwnerTools(options: {
    ownerTools: JobGateOwnerTools;
    code: string;
    state: unknown;
    signal?: AbortSignal;
}): Promise<unknown> {
    const { signal } = options;
    return withOwnerToolRuntime(options.ownerTools, signal, (runtime, allowNestedScripts) => runJobGate({
        code: options.code, state: options.state, runtime, signal, allowNestedScripts,
    }));
}
