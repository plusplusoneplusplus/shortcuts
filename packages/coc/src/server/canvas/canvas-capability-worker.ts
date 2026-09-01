/**
 * The program an ASYNC extension-canvas capability runs inside. It is shipped
 * as a SOURCE STRING and started with `new Worker(source, { eval: true })`
 * rather than as a file on disk: the server runs from `dist/` in production and
 * straight from TypeScript under vitest, so a worker entry resolved by path
 * would have to be found differently in each. A string has one form everywhere.
 *
 * Why a worker at all: the sync path's `vm.runInContext({ timeout })` bounds
 * only SYNCHRONOUS execution. A capability that returns a promise hands control
 * back immediately and its continuation runs unbounded — and a `vm`
 * continuation cannot be terminated. A worker thread can be `terminate()`d, so
 * a runaway async capability has an actual kill switch.
 *
 * Inside the worker the capability still runs in a fresh `node:vm` context, for
 * the same reason the sync path does: it prevents accidental host-state
 * coupling. As with the sync path this is not a hard security boundary — it
 * matches CoC's local trust model (the same trust level as AI-authored shell
 * commands in autopilot). The worker is what makes the run terminable, not what
 * makes it safe.
 *
 * The only capability the vm context is handed is `host`:
 *   - `host.complete(prompt, { model? })` — one-shot model call, proxied over
 *     the message port to the parent, capped per run.
 * There is deliberately NO `host.fetch`. CoC's own API listens on loopback and
 * is unauthenticated, so arbitrary outbound HTTP from inside a capability would
 * hand the sandbox the entire CoC API. `host.complete` has a fixed destination
 * the caller cannot choose, which removes that exposure outright.
 *
 * Pure Node.js; uses only built-in modules.
 */

/** `workerData` handed to the worker at start. Structured-cloneable only. */
export interface CapabilityWorkerData {
    capabilitiesJs: string;
    capability: string;
    /** Parsed canvas state (already JSON-validated by the parent). */
    state: unknown;
    params: unknown;
    /** Hard cap on `host.complete` calls for this run. */
    maxCompletions: number;
    /** Budget for the synchronous top-level evaluation of `capabilitiesJs`. */
    loadTimeoutMs: number;
    /** Byte ceiling on the serialized next state. */
    maxStateBytes: number;
}

/** Worker → parent: the capability asked for a model completion. */
export interface CapabilityCompleteRequestMessage {
    type: 'complete-request';
    id: number;
    prompt: string;
    model?: string;
}

/** Worker → parent: the run finished (successfully or not). */
export type CapabilityResultMessage =
    | { type: 'result'; ok: true; state: string }
    | { type: 'result'; ok: false; error: string };

export type CapabilityWorkerMessage = CapabilityCompleteRequestMessage | CapabilityResultMessage;

/** Parent → worker: the answer to one `complete-request`. */
export type CapabilityCompleteResponseMessage =
    | { type: 'complete-response'; id: number; ok: true; text: string }
    | { type: 'complete-response'; id: number; ok: false; code: string; error: string };

/**
 * The worker program.
 *
 * Plain ES5-ish CommonJS on purpose — it is never compiled by tsc, so it must
 * be valid JavaScript exactly as written here.
 */
export const CAPABILITY_WORKER_SOURCE = `
'use strict';
const vm = require('vm');
const { parentPort, workerData } = require('worker_threads');

const capabilitiesJs = workerData.capabilitiesJs;
const capabilityName = workerData.capability;
const maxCompletions = workerData.maxCompletions;
const loadTimeoutMs = workerData.loadTimeoutMs;
const maxStateBytes = workerData.maxStateBytes;

let completionsUsed = 0;
let nextCompletionId = 1;
const pendingCompletions = new Map();

function hostError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}

parentPort.on('message', (msg) => {
    if (!msg || msg.type !== 'complete-response') return;
    const entry = pendingCompletions.get(msg.id);
    if (!entry) return;
    pendingCompletions.delete(msg.id);
    if (msg.ok) entry.resolve(msg.text);
    else entry.reject(hostError(msg.code || 'capability-error', msg.error || 'Completion failed'));
});

// The whole host surface handed to a capability. One method, fixed destination.
const host = {
    complete(prompt, options) {
        if (typeof prompt !== 'string' || !prompt.trim()) {
            return Promise.reject(hostError('capability-error', 'host.complete needs a non-empty prompt string'));
        }
        if (completionsUsed >= maxCompletions) {
            return Promise.reject(hostError(
                'quota',
                'host.complete is limited to ' + maxCompletions + ' calls per capability run',
            ));
        }
        completionsUsed++;
        const id = nextCompletionId++;
        const model = options && typeof options.model === 'string' ? options.model : undefined;
        return new Promise((resolve, reject) => {
            pendingCompletions.set(id, { resolve: resolve, reject: reject });
            parentPort.postMessage({ type: 'complete-request', id: id, prompt: prompt, model: model });
        });
    },
};

function finish(message) {
    parentPort.postMessage(message);
}

async function run() {
    // Timers are the one host global an async capability genuinely needs — a
    // delay, a retry backoff, a poll. They are safe to hand over here in a way
    // they would not be on the sync path: everything they schedule dies with
    // the thread when the parent terminates it. Still no require, no process,
    // and no fetch — see the module header on why there is no network at all.
    const context = vm.createContext({
        host: host,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        queueMicrotask: queueMicrotask,
    }, { codeGeneration: { strings: false, wasm: false } });

    try {
        vm.runInContext(capabilitiesJs, context, { timeout: loadTimeoutMs });
    } catch (err) {
        return finish({ type: 'result', ok: false, error: 'Extension capability script failed to load: ' + errorMessage(err) });
    }

    const capabilities = context.capabilities;
    if (!capabilities || typeof capabilities !== 'object') {
        return finish({ type: 'result', ok: false, error: 'Extension script must assign a top-level \\\`capabilities\\\` object' });
    }
    const fn = capabilities[capabilityName];
    if (typeof fn !== 'function') {
        const available = Object.keys(capabilities).join(', ') || 'none';
        return finish({ type: 'result', ok: false, error: 'Unknown capability "' + capabilityName + '". Available: ' + available });
    }

    let result;
    try {
        // No vm timeout here: the run as a whole is bounded by the parent's
        // wall clock, which terminates the thread — a bound a vm continuation
        // could not have given us.
        // \`host\` arrives BOTH as the third argument and as a context global:
        // the argument is what the tool documentation teaches, the global is
        // what a capability that closed over it at load time will reach for.
        result = await Promise.resolve(fn(
            workerData.state,
            workerData.params === undefined || workerData.params === null ? {} : workerData.params,
            host,
        ));
    } catch (err) {
        return finish({ type: 'result', ok: false, error: 'Capability "' + capabilityName + '" threw: ' + errorMessage(err) });
    }

    if (result === undefined || result === null || typeof result !== 'object') {
        return finish({ type: 'result', ok: false, error: 'Capability "' + capabilityName + '" must return the complete next state object' });
    }

    let nextJson;
    try {
        nextJson = JSON.stringify(result, null, 2);
    } catch (err) {
        return finish({ type: 'result', ok: false, error: 'Capability "' + capabilityName + '" returned non-serializable state: ' + errorMessage(err) });
    }
    if (nextJson === undefined) {
        return finish({ type: 'result', ok: false, error: 'Capability "' + capabilityName + '" must return the complete next state object' });
    }
    if (Buffer.byteLength(nextJson, 'utf-8') > maxStateBytes) {
        return finish({ type: 'result', ok: false, error: 'Capability result exceeds the 1 MB canvas state limit' });
    }

    finish({ type: 'result', ok: true, state: nextJson });
}

run().catch((err) => {
    finish({ type: 'result', ok: false, error: 'Capability "' + capabilityName + '" failed: ' + errorMessage(err) });
});
`;
