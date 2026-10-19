/**
 * ToolScriptRunner — runs a model-written `run_tool_script` script that calls
 * CoC tools as async functions, and returns only what the script returns.
 *
 * The script runs in a worker thread (see `tool-script-worker.ts`). Each
 * `tools.X(args)` call is proxied back here, where this module enforces the
 * per-script call budget, the in-flight limit and the nesting depth, then runs
 * the call through `CocToolRuntime.callTool` — the same (already filtered and
 * approval-gated) handlers the model could call directly.
 *
 * Provider-neutral: depends only on `CocToolRuntime` and `ToolEvent`. Inner
 * calls are reported through `onToolEvent` with `parentToolCallId` set to the
 * script's own call id, so the timeline nests them under the script.
 *
 * There is no timeout and no output cap by design. A run ends when the script
 * returns or throws, or when `signal` aborts (turn end / cancel).
 */

import * as crypto from 'crypto';
import { Worker } from 'worker_threads';
import type { ToolEvent } from '../types';
import type { CocToolRuntime } from './coc-tool-runtime';
import {
    TOOL_SCRIPT_WORKER_SOURCE,
    type ToolScriptError,
    type ToolScriptErrorCode,
    type ToolScriptLogLevel,
    type ToolScriptResultMessage,
    type ToolScriptWorkerData,
    type ToolScriptWorkerMessage,
} from './tool-script-worker';

/** Name of the tool scripts may call to start a nested script. */
export const RUN_TOOL_SCRIPT_TOOL_NAME = 'run_tool_script';
/** The top-level script is depth 1. */
export const MAX_SCRIPT_DEPTH = 3;
export const MAX_CALLS_PER_SCRIPT = 50;
export const MAX_IN_FLIGHT_PER_SCRIPT = 4;
/** Guards host memory only; not a time or output limit. */
const WORKER_MAX_OLD_GENERATION_MB = 256;

export interface ToolScriptRunOptions {
    code: string;
    /** Runtime over the scriptable tools only. */
    runtime: CocToolRuntime;
    /** `toolCallId` of the script call; parent id for inner call events. */
    scriptToolCallId: string;
    /** 1 for a top-level script. */
    depth: number;
    signal?: AbortSignal;
    /** Optional JSON state, exposed only when supplied (background conditions). */
    state?: unknown;
    /** Reject lossy JSON conversion before the value leaves the worker. Default false. */
    requireJsonResult?: boolean;
    onToolEvent?: (event: ToolEvent) => void;
}

export interface ToolScriptCallRecord {
    name: string;
    ok: boolean;
    error?: string;
    /** Number of image blocks the tool returned (not passed into the script). */
    images?: number;
}

export interface ToolScriptRunResult {
    ok: boolean;
    result?: unknown;
    error?: ToolScriptError;
    logs: Array<{ level: ToolScriptLogLevel; text: string }>;
    calls: ToolScriptCallRecord[];
    callCount: number;
}

type CallOutcome =
    | { ok: true; text: string; images?: number }
    | { ok: false; message: string; code: ToolScriptErrorCode };

/** Run one script to completion. Never throws. */
export function runToolScript(opts: ToolScriptRunOptions): Promise<ToolScriptRunResult> {
    const logs: ToolScriptRunResult['logs'] = [];
    const calls: ToolScriptCallRecord[] = [];
    let callCount = 0;

    if (opts.signal?.aborted) {
        return Promise.resolve(abortedResult());
    }

    // Aborted when the script settles (any outcome) or the caller aborts, so
    // in-flight inner calls and nested scripts never outlive the run.
    const runAbort = new AbortController();
    const openCalls = new Map<string, string>(); // toolCallId → toolName
    let inFlight = 0;
    const slotWaiters: Array<() => void> = [];

    const toolNames = [
        ...opts.runtime.listTools().map(t => t.name).filter(name => name !== RUN_TOOL_SCRIPT_TOOL_NAME),
        RUN_TOOL_SCRIPT_TOOL_NAME,
    ];
    const workerData: ToolScriptWorkerData = {
        code: opts.code,
        toolNames,
        stateJson: opts.state === undefined ? undefined : JSON.stringify(opts.state),
        requireJsonResult: opts.requireJsonResult,
    };
    const worker = new Worker(TOOL_SCRIPT_WORKER_SOURCE, {
        eval: true,
        workerData,
        resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB },
    });

    function emit(event: ToolEvent): void {
        try {
            opts.onToolEvent?.(event);
        } catch {
            // An observer must never break the script.
        }
    }

    function abortedResult(): ToolScriptRunResult {
        return {
            ok: false,
            error: { name: 'ToolCallError', message: 'The script was aborted', code: 'ABORTED' },
            logs, calls, callCount,
        };
    }

    async function acquireSlot(): Promise<void> {
        while (inFlight >= MAX_IN_FLIGHT_PER_SCRIPT) {
            await new Promise<void>(resolve => slotWaiters.push(resolve));
        }
        inFlight++;
    }

    function releaseSlot(): void {
        inFlight--;
        slotWaiters.shift()?.();
    }

    async function invoke(name: string, args: unknown, toolCallId: string): Promise<CallOutcome> {
        if (name === RUN_TOOL_SCRIPT_TOOL_NAME) {
            const code = (args as { code?: unknown } | null)?.code;
            if (typeof code !== 'string') {
                return { ok: false, message: 'run_tool_script needs a `code` string', code: 'TOOL_ERROR' };
            }
            const child = await runToolScript({
                code,
                runtime: opts.runtime,
                scriptToolCallId: toolCallId,
                depth: opts.depth + 1,
                signal: runAbort.signal,
                onToolEvent: opts.onToolEvent,
            });
            if (!child.ok) {
                return {
                    ok: false,
                    message: child.error?.message ?? 'Nested script failed',
                    code: child.error?.code === 'ABORTED' ? 'ABORTED' : 'TOOL_ERROR',
                };
            }
            return { ok: true, text: JSON.stringify(toModelPayload(child)) };
        }
        const result = await opts.runtime.callTool(name, args, { signal: runAbort.signal, toolCallId });
        const text = result.content[0].text;
        if (result.isError) return { ok: false, message: text || `${name} failed`, code: 'TOOL_ERROR' };
        const images = result.content.filter(c => c.type === 'image').length;
        return images > 0 ? { ok: true, text, images } : { ok: true, text };
    }

    async function handleCall(id: number, name: string, args: unknown): Promise<void> {
        const reply = (msg: ToolScriptResultMessage) => {
            if (!settled) worker.postMessage(msg);
        };
        const fail = (message: string, code: ToolScriptErrorCode) => {
            calls.push({ name, ok: false, error: message });
            reply({ type: 'result', id, ok: false, error: { message, code } });
        };

        if (callCount >= MAX_CALLS_PER_SCRIPT) {
            return fail(`A script may make at most ${MAX_CALLS_PER_SCRIPT} tool calls`, 'CALL_LIMIT');
        }
        callCount++;
        if (name === RUN_TOOL_SCRIPT_TOOL_NAME && opts.depth + 1 > MAX_SCRIPT_DEPTH) {
            return fail(`run_tool_script can nest at most ${MAX_SCRIPT_DEPTH} levels deep`, 'DEPTH_LIMIT');
        }

        await acquireSlot();
        if (settled) { releaseSlot(); return; }

        const toolCallId = crypto.randomUUID();
        openCalls.set(toolCallId, name);
        emit({
            type: 'tool-start',
            toolCallId,
            toolName: name,
            parentToolCallId: opts.scriptToolCallId,
            parameters: args && typeof args === 'object' ? args as Record<string, unknown> : {},
        });

        let outcome: CallOutcome;
        try {
            outcome = await invoke(name, args, toolCallId);
        } catch (err) {
            outcome = { ok: false, message: err instanceof Error ? err.message : String(err), code: 'TOOL_ERROR' };
        } finally {
            releaseSlot();
        }

        // A run that already settled reported this call as aborted.
        if (!openCalls.delete(toolCallId)) return;
        if (outcome.ok) {
            emit({ type: 'tool-complete', toolCallId, toolName: name, parentToolCallId: opts.scriptToolCallId, result: outcome.text });
            calls.push(outcome.images ? { name, ok: true, images: outcome.images } : { name, ok: true });
            reply({ type: 'result', id, ok: true, text: outcome.text });
        } else {
            emit({ type: 'tool-failed', toolCallId, toolName: name, parentToolCallId: opts.scriptToolCallId, error: outcome.message });
            fail(outcome.message, outcome.code);
        }
    }

    let settled = false;
    return new Promise<ToolScriptRunResult>((resolve) => {
        const onAbort = () => finish(abortedResult());

        function finish(result: ToolScriptRunResult): void {
            if (settled) return;
            settled = true;
            opts.signal?.removeEventListener('abort', onAbort);
            void worker.terminate();
            runAbort.abort();
            for (const [toolCallId, toolName] of openCalls) {
                emit({ type: 'tool-failed', toolCallId, toolName, parentToolCallId: opts.scriptToolCallId, error: 'aborted' });
            }
            openCalls.clear();
            // Wake queued calls so they observe `settled` and drop out.
            for (const wake of slotWaiters.splice(0)) wake();
            resolve(result);
        }

        opts.signal?.addEventListener('abort', onAbort, { once: true });

        worker.on('message', (msg: ToolScriptWorkerMessage) => {
            if (settled || !msg) return;
            if (msg.type === 'log') {
                logs.push({ level: msg.level, text: msg.text });
            } else if (msg.type === 'call') {
                void handleCall(msg.id, msg.name, msg.args);
            } else if (msg.type === 'done') {
                if (msg.ok) {
                    finish({
                        ok: true,
                        result: msg.value === undefined ? null : JSON.parse(msg.value),
                        logs, calls, callCount,
                    });
                } else {
                    finish({ ok: false, error: msg.error, logs, calls, callCount });
                }
            }
        });
        worker.on('error', (err: Error) => {
            finish({ ok: false, error: { name: err.name || 'Error', message: err.message }, logs, calls, callCount });
        });
        worker.on('exit', (code) => {
            finish({
                ok: false,
                error: { name: 'Error', message: `The script worker exited unexpectedly (code ${code})` },
                logs, calls, callCount,
            });
        });
    });
}

/**
 * The JSON shape returned to the model (and to a parent script for a nested
 * run): `{ result, logs, calls, callCount }` on success, `{ error, ... }` on failure.
 */
export function toModelPayload(run: ToolScriptRunResult): Record<string, unknown> {
    const head = run.ok ? { result: run.result ?? null } : { error: run.error };
    return { ...head, logs: run.logs, calls: run.calls, callCount: run.callCount };
}
