/**
 * Executes extension-canvas capabilities — `(state, params) => nextState`
 * functions authored as part of an extension canvas — against the canvas's
 * JSON shared state.
 *
 * TWO EXECUTION PATHS, chosen by the manifest's per-capability `async` flag:
 *
 *   - SYNC (default, and every capability stored before `async` existed). The
 *     script runs in a fresh `node:vm` context with no require, no process, and
 *     a 1000 ms wall-clock timeout. Unchanged, deliberately: nothing already
 *     stored may change behaviour.
 *
 *   - ASYNC (`async: true`). The script runs in a `worker_threads` Worker with
 *     a 30 s budget and a small `host` object proxied over the message port.
 *     This is forced, not stylistic: `vm.runInContext({ timeout })` bounds only
 *     the SYNCHRONOUS portion, so a capability that returns a promise runs its
 *     continuation unbounded — and a `vm` continuation cannot be terminated.
 *     `Promise.race` would bound the waiting, not the work. A worker can be
 *     `terminate()`d, so a runaway has an actual kill switch. See
 *     `canvas-capability-worker.ts`.
 *
 * The `vm` context matches CoC's local trust model (the same trust level as
 * AI-authored shell commands in autopilot): it prevents accidental host-state
 * coupling, it is not a hard security boundary. The worker adds terminability,
 * not isolation.
 *
 * Bounds on the async path, none of which existed to lean on (there is no
 * general rate limiter anywhere in the server):
 *   - {@link ASYNC_CAPABILITY_TIMEOUT_MS} covers the WHOLE run, model time included
 *   - {@link MAX_HOST_COMPLETIONS_PER_RUN} `host.complete` calls per run
 *   - {@link MAX_CONCURRENT_ASYNC_RUNS} runs in flight process-wide, the rest queued
 *
 * Script contract: the extension's `capabilities.js` assigns a top-level
 * `capabilities` object whose values take `(state, params)` and return the
 * complete next state object — or, on the async path, a promise of it.
 */

import * as vm from 'vm';
import { Worker } from 'worker_threads';
import {
    CAPABILITY_WORKER_SOURCE,
    type CapabilityCompleteResponseMessage,
    type CapabilityWorkerData,
    type CapabilityWorkerMessage,
} from './canvas-capability-worker';

const CAPABILITY_TIMEOUT_MS = 1000;
const MAX_STATE_BYTES = 1024 * 1024;

/**
 * Wall clock for one async capability run, model calls included. Thirty times
 * the sync budget because the point of the async path is doing something slow;
 * bounded because the thread is killed when it expires.
 */
export const ASYNC_CAPABILITY_TIMEOUT_MS = 30_000;

/** `host.complete` calls one run may make. A loop would otherwise burn quota. */
export const MAX_HOST_COMPLETIONS_PER_RUN = 3;

/** Async runs in flight process-wide. Further runs wait for a slot. */
export const MAX_CONCURRENT_ASYNC_RUNS = 4;

/**
 * Runs allowed to WAIT for a slot. Past this the request is refused rather than
 * parked, so a pile-up surfaces as an error the caller can act on instead of a
 * request that hangs for minutes.
 */
export const MAX_QUEUED_ASYNC_RUNS = 20;

export type CapabilityRunResult =
    | { ok: true; state: string }
    | { ok: false; error: string };

/** One `host.complete` call, as it reaches the parent. */
export interface CapabilityCompletionRequest {
    prompt: string;
    model?: string;
}

/**
 * Services `host.complete` for one run. Supplied by the caller so the runner
 * never has to know about models, preferences or attribution — the caller
 * builds it already bound to the workspace/canvas/process it is for, which is
 * also where the logging lives.
 *
 * Absent means "no model access": `host.complete` rejects with `code: 'offline'`
 * rather than hanging, which is what an exported (server-less) artifact and a
 * flag-off server both need.
 */
export type CapabilityCompleteFn = (
    request: CapabilityCompletionRequest,
) => Promise<{ ok: true; text: string } | { ok: false; error: string; code?: string }>;

export interface RunCanvasCapabilityOptions {
    /** Manifest's per-capability `async` flag. Anything but `true` takes the vm path. */
    async?: boolean;
    /** Services `host.complete`. Omit to leave the capability without model access. */
    complete?: CapabilityCompleteFn;
    /**
     * Shorten the async budget. A test seam — waiting the real 30 s to prove a
     * runaway is killed would make the suite unusable. Clamped to at most
     * {@link ASYNC_CAPABILITY_TIMEOUT_MS}, so no caller can use it to buy a
     * capability more time than the policy allows.
     */
    timeoutMs?: number;
}

export const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidCapabilityName(name: string): boolean {
    return typeof name === 'string' && CAPABILITY_NAME_PATTERN.test(name);
}

/**
 * Run one capability against the canvas state.
 *
 * @param capabilitiesJs - The extension's capability script (assigns `capabilities = {...}`).
 * @param stateJson - Current canvas content (JSON shared state; empty = `{}`).
 * @param params - Caller-provided parameters (AI tool call or UI action).
 * @param options - Async execution and host access; omit for the legacy sync path.
 */
export async function runCanvasCapability(
    capabilitiesJs: string,
    capability: string,
    stateJson: string,
    params: unknown,
    options?: RunCanvasCapabilityOptions,
): Promise<CapabilityRunResult> {
    if (!isValidCapabilityName(capability)) {
        return { ok: false, error: 'Invalid capability name' };
    }

    let state: unknown;
    try {
        state = stateJson.trim() ? JSON.parse(stateJson) : {};
    } catch {
        return { ok: false, error: 'Canvas state is not valid JSON — fix it with write_canvas first' };
    }

    return options?.async === true
        ? runAsyncCapability(capabilitiesJs, capability, state, params, options)
        : runSyncCapability(capabilitiesJs, capability, state, params);
}

// ============================================================================
// Sync path — the original vm runner, unchanged
// ============================================================================

function runSyncCapability(
    capabilitiesJs: string,
    capability: string,
    state: unknown,
    params: unknown,
): CapabilityRunResult {
    const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    try {
        vm.runInContext(capabilitiesJs, context, { timeout: CAPABILITY_TIMEOUT_MS });
    } catch (err) {
        return { ok: false, error: `Extension capability script failed to load: ${errorMessage(err)}` };
    }

    const capabilities = (context as Record<string, unknown>).capabilities;
    if (!capabilities || typeof capabilities !== 'object') {
        return { ok: false, error: 'Extension script must assign a top-level `capabilities` object' };
    }
    const fn = (capabilities as Record<string, unknown>)[capability];
    if (typeof fn !== 'function') {
        const available = Object.keys(capabilities as Record<string, unknown>).join(', ') || 'none';
        return { ok: false, error: `Unknown capability "${capability}". Available: ${available}` };
    }

    let result: unknown;
    try {
        (context as Record<string, unknown>).__state = state;
        (context as Record<string, unknown>).__params = params ?? {};
        result = vm.runInContext(
            `capabilities[${JSON.stringify(capability)}](__state, __params)`,
            context,
            { timeout: CAPABILITY_TIMEOUT_MS },
        );
    } catch (err) {
        return { ok: false, error: `Capability "${capability}" threw: ${errorMessage(err)}` };
    }

    if (result === undefined || result === null || typeof result !== 'object') {
        return { ok: false, error: `Capability "${capability}" must return the complete next state object` };
    }

    let nextJson: string;
    try {
        nextJson = JSON.stringify(result, null, 2);
    } catch (err) {
        return { ok: false, error: `Capability "${capability}" returned non-serializable state: ${errorMessage(err)}` };
    }
    if (Buffer.byteLength(nextJson, 'utf-8') > MAX_STATE_BYTES) {
        return { ok: false, error: 'Capability result exceeds the 1 MB canvas state limit' };
    }

    return { ok: true, state: nextJson };
}

// ============================================================================
// Async path — worker lifecycle, budget, and the host proxy
// ============================================================================

/**
 * Workers currently alive. Exists so the "the worker is actually gone
 * afterwards" property is observable rather than assumed — a runner that
 * returned a timeout error while leaving the thread spinning would look
 * identical to one that killed it.
 */
const activeWorkers = new Set<Worker>();

/** How many async capability workers are alive right now. */
export function getActiveCapabilityWorkerCount(): number {
    return activeWorkers.size;
}

let slotsInUse = 0;
const slotWaiters: Array<() => void> = [];

/**
 * Take one of the {@link MAX_CONCURRENT_ASYNC_RUNS} slots, waiting in FIFO
 * order when they are all taken. Returns null when the wait queue itself is
 * full — the caller turns that into an error rather than parking.
 *
 * A released slot is handed DIRECTLY to the next waiter (`slotsInUse` is not
 * decremented) instead of being freed and re-taken. Freeing it would let a
 * caller arriving in between take the slot synchronously and the woken waiter
 * then push the count past the cap.
 */
async function acquireRunSlot(): Promise<(() => void) | null> {
    if (slotsInUse < MAX_CONCURRENT_ASYNC_RUNS) {
        slotsInUse++;
    } else if (slotWaiters.length >= MAX_QUEUED_ASYNC_RUNS) {
        return null;
    } else {
        await new Promise<void>(resolve => slotWaiters.push(resolve));
    }

    let released = false;
    return () => {
        if (released) return;
        released = true;
        const next = slotWaiters.shift();
        if (next) next();
        else slotsInUse--;
    };
}

async function runAsyncCapability(
    capabilitiesJs: string,
    capability: string,
    state: unknown,
    params: unknown,
    options: RunCanvasCapabilityOptions,
): Promise<CapabilityRunResult> {
    const release = await acquireRunSlot();
    if (!release) {
        return { ok: false, error: 'Too many async capability runs are in flight — try again in a moment' };
    }

    const workerData: CapabilityWorkerData = {
        capabilitiesJs,
        capability,
        state,
        params: params ?? {},
        maxCompletions: MAX_HOST_COMPLETIONS_PER_RUN,
        loadTimeoutMs: CAPABILITY_TIMEOUT_MS,
        maxStateBytes: MAX_STATE_BYTES,
    };

    let worker: Worker;
    try {
        worker = new Worker(CAPABILITY_WORKER_SOURCE, { eval: true, workerData });
    } catch (err) {
        release();
        return { ok: false, error: `Failed to start the capability worker: ${errorMessage(err)}` };
    }
    activeWorkers.add(worker);

    const budgetMs = Math.min(
        ASYNC_CAPABILITY_TIMEOUT_MS,
        typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : ASYNC_CAPABILITY_TIMEOUT_MS,
    );

    const outcome = await new Promise<CapabilityRunResult>(resolve => {
        let settled = false;
        const settle = (result: CapabilityRunResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            settle({
                ok: false,
                error: `Capability "${capability}" exceeded the ${budgetMs}ms async budget and was terminated`,
            });
        }, budgetMs);

        worker.on('message', (message: CapabilityWorkerMessage) => {
            if (!message || typeof message !== 'object') return;
            if (message.type === 'complete-request') {
                void serviceCompletion(worker, message.id, message.prompt, message.model, options.complete);
                return;
            }
            if (message.type === 'result') {
                settle(message.ok ? { ok: true, state: message.state } : { ok: false, error: message.error });
            }
        });
        worker.on('error', err => {
            settle({ ok: false, error: `Capability "${capability}" threw: ${errorMessage(err)}` });
        });
        worker.on('exit', code => {
            settle({ ok: false, error: `Capability "${capability}" exited without returning state (code ${code})` });
        });
    });

    // Terminate unconditionally, including on success. A capability is free to
    // resolve its state and then keep spinning; without this the thread would
    // outlive the request that started it and the budget would bound nothing.
    try {
        await worker.terminate();
    } catch {
        // Already gone — the only thing terminate() could fail on here.
    }
    activeWorkers.delete(worker);
    release();
    return outcome;
}

/**
 * Answer one `host.complete` request from the worker.
 *
 * Always replies. A silent drop would leave the capability's promise pending
 * until the 30 s budget killed the thread, turning a configuration state ("no
 * model access here") into a timeout the author cannot diagnose.
 */
async function serviceCompletion(
    worker: Worker,
    id: number,
    prompt: unknown,
    model: unknown,
    complete: CapabilityCompleteFn | undefined,
): Promise<void> {
    const reply = (message: CapabilityCompleteResponseMessage): void => {
        try {
            worker.postMessage(message);
        } catch {
            // The worker was terminated while its completion was in flight.
        }
    };

    if (!complete) {
        reply({
            type: 'complete-response',
            id,
            ok: false,
            code: 'offline',
            error: 'host.complete is unavailable — canvas host APIs are off, or this artifact is running without a server',
        });
        return;
    }

    try {
        const result = await complete({
            prompt: typeof prompt === 'string' ? prompt : String(prompt ?? ''),
            ...(typeof model === 'string' && model ? { model } : {}),
        });
        reply(result.ok
            ? { type: 'complete-response', id, ok: true, text: result.text }
            : { type: 'complete-response', id, ok: false, code: result.code ?? 'capability-error', error: result.error });
    } catch (err) {
        reply({ type: 'complete-response', id, ok: false, code: 'capability-error', error: errorMessage(err) });
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
