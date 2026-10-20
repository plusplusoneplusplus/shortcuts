import { runToolScript, type CocToolRuntime } from '@plusplusoneplusplus/coc-agent-sdk';

export const SCRIPT_CONDITION_DEADLINE_MS = 60_000;

export interface ScriptConditionRunOptions {
    code: string;
    state: unknown;
    /** Owner-resolved, unattended tools. The caller owns and disposes this runtime. */
    runtime: CocToolRuntime;
    /** Owner/rule revocation and server shutdown cancellation. */
    signal?: AbortSignal;
    /** Set true only when the owner's run_tool_script tool is enabled and ungated. */
    allowNestedScripts?: boolean;
}

/** Trigger-only deadline; the shared chat scripting engine remains unbounded. */
export async function runScriptCondition(options: ScriptConditionRunOptions): Promise<unknown> {
    options.signal?.throwIfAborted();
    const deadline = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => {
        deadline.abort(new Error('Script condition exceeded its 60-second deadline'));
    }, SCRIPT_CONDITION_DEADLINE_MS);
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
        // The engine terminates the worker on abort; retain the trigger's reason.
        signal.throwIfAborted();
        if (!run.ok) {
            const error = new Error(run.error?.message ?? 'Script condition failed');
            error.name = run.error?.name ?? 'Error';
            throw error;
        }
        return run.result;
    } finally {
        clearTimeout(timer);
    }
}
