import { runToolScript, type CocToolRuntime } from '@plusplusoneplusplus/coc-agent-sdk';

export const REFRAIN_GATE_DEADLINE_MS = 60_000;

export interface RefrainGateRunOptions {
    code: string;
    state: unknown;
    /** Owner-resolved, unattended tools. The caller owns and disposes this runtime. */
    runtime: CocToolRuntime;
    /** Owner/job revocation and server shutdown cancellation. */
    signal?: AbortSignal;
    /** Set true only when the owner's run_tool_script tool is enabled and ungated. */
    allowNestedScripts?: boolean;
}

/** Gate-only deadline; the shared chat scripting engine remains unbounded. */
export async function runRefrainGate(options: RefrainGateRunOptions): Promise<unknown> {
    options.signal?.throwIfAborted();
    const deadline = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => {
        deadline.abort(new Error('Gate script exceeded its 60-second deadline'));
    }, REFRAIN_GATE_DEADLINE_MS);
    try {
        const run = await runToolScript({
            code: options.code,
            state: options.state,
            requireJsonResult: true,
            allowNestedScripts: options.allowNestedScripts === true,
            runtime: options.runtime,
            scriptToolCallId: '',
            depth: 1,
            signal,
        });
        // The engine terminates the worker on abort; retain the caller's reason.
        signal.throwIfAborted();
        if (!run.ok) {
            const error = new Error(run.error?.message ?? 'Gate script failed');
            error.name = run.error?.name ?? 'Error';
            throw error;
        }
        return run.result;
    } finally {
        clearTimeout(timer);
    }
}
