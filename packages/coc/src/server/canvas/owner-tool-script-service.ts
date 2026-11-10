import type { OwnerScriptRunner } from '../executors/owner-script-runner';
import { OwnerScriptUnavailableError } from '../executors/owner-script-runner';
import { MAX_HOST_SCRIPT_RESULT_BYTES, validateCanvasManifestTools } from './canvas-script-bridge';

export interface OwnerToolScriptRequest {
    code: string;
    state?: unknown;
}

export type OwnerToolScriptOutcome = {
    ok: boolean;
    result?: unknown;
    code?: string;
    error?: string;
    logs: string[];
    callCount: number;
};

/** Internal service, independent of optional canvas host/script feature flags. */
export async function runOwnerToolScript(options: {
    workspaceId: string;
    processId: string;
    tools: readonly string[];
    request: OwnerToolScriptRequest;
    runner: OwnerScriptRunner;
    signal: AbortSignal;
    /** Test seams; production uses a 30s budget and 16 MiB complete-envelope ceiling. */
    timeoutMs?: number;
    maxResultBytes?: number;
}): Promise<OwnerToolScriptOutcome> {
    const fail = (code: string, error: string): OwnerToolScriptOutcome => ({ ok: false, code, error, logs: [], callCount: 0 });
    const declaration = validateCanvasManifestTools(options.tools);
    if (!declaration.ok) return fail('tool-not-allowed', declaration.error);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Tool script timed out')), options.timeoutMs ?? 30_000);
    let onAbort: (() => void) | undefined;
    try {
        controller.signal.throwIfAborted();
        const run = await Promise.race([
            options.runner({
                workspaceId: options.workspaceId, processId: options.processId,
                code: options.request.code, state: options.request.state,
                allowTools: declaration.tools, includeMcpTools: false,
                signal: controller.signal,
            }),
            new Promise<never>((_, reject) => {
                onAbort = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', onAbort, { once: true });
                if (controller.signal.aborted) onAbort();
            }),
        ]);
        controller.signal.throwIfAborted();
        const outcome: OwnerToolScriptOutcome = {
            ok: run.ok, logs: run.logs.map(entry => entry.text), callCount: run.callCount,
            ...(run.ok ? { result: run.result ?? null } : { code: 'script-error', error: run.error?.message ?? 'Script failed' }),
        };
        // Check logs and envelope too; never emit partial or truncated JSON.
        if (Buffer.byteLength(JSON.stringify(outcome), 'utf8') > (options.maxResultBytes ?? MAX_HOST_SCRIPT_RESULT_BYTES)) {
            return fail('result-limit', 'Tool script result exceeds the serialized byte limit');
        }
        return outcome;
    } catch (error) {
        if (controller.signal.aborted) return fail(options.signal.aborted ? 'aborted' : 'timeout',
            options.signal.aborted ? 'Tool script cancelled' : 'Tool script timed out');
        if (error instanceof OwnerScriptUnavailableError) return fail('no-owner', error.message);
        return fail('script-error', error instanceof Error ? error.message : String(error));
    } finally {
        clearTimeout(timer);
        options.signal.removeEventListener('abort', abort);
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    }
}
