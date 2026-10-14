/**
 * The program a `run_tool_script` script runs inside. Shipped as a SOURCE
 * STRING and started with `new Worker(source, { eval: true })` — the same
 * pattern as the coc canvas capability worker — so it has one form whether
 * the package runs from `dist/` or straight from TypeScript under vitest.
 *
 * The worker exists so a run can be killed (`worker.terminate()`), not to make
 * it safe. The script runs in a fresh `node:vm` context to avoid accidental
 * host-state coupling; that is not a security boundary and matches CoC's
 * local trust model (the same trust as AI-written shell commands).
 *
 * The context gets `tools`, `console` and `ToolCallError` plus the standard
 * built-ins. There is no `require`, `process`, `fetch` or timers. Every
 * `tools.<name>(args)` call is proxied to the parent over the message port;
 * the parent enforces the call budget, concurrency and nesting depth.
 *
 * Pure Node.js; uses only built-in modules.
 */

/** `workerData` handed to the worker at start. */
export interface ToolScriptWorkerData {
    code: string;
    toolNames: string[];
}

export type ToolScriptErrorCode =
    | 'TOOL_ERROR'
    | 'UNKNOWN_TOOL'
    | 'CALL_LIMIT'
    | 'DEPTH_LIMIT'
    | 'ABORTED'
    | 'UNSERIALIZABLE_RESULT';

export interface ToolScriptError {
    name: string;
    message: string;
    code?: string;
}

export type ToolScriptLogLevel = 'log' | 'info' | 'warn' | 'error';

/** Worker → parent messages. */
export type ToolScriptWorkerMessage =
    | { type: 'call'; id: number; name: string; args: unknown }
    | { type: 'log'; level: ToolScriptLogLevel; text: string }
    | { type: 'done'; ok: true; value?: string }
    | { type: 'done'; ok: false; error: ToolScriptError };

/** Parent → worker: the answer to one `call`. */
export type ToolScriptResultMessage =
    | { type: 'result'; id: number; ok: true; text: string }
    | { type: 'result'; id: number; ok: false; error: { message: string; code: ToolScriptErrorCode } };

/**
 * The worker program.
 *
 * Plain CommonJS on purpose — it is never compiled by tsc, so it must be
 * valid JavaScript exactly as written here.
 */
export const TOOL_SCRIPT_WORKER_SOURCE = `
'use strict';
const vm = require('vm');
const { parentPort, workerData } = require('worker_threads');

const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
// Built in the script's own realm so \`instanceof Error\`, \`Array.isArray\` and
// friends behave the way script authors expect.
const CtxPromise = vm.runInContext('Promise', context);
const CtxJSON = vm.runInContext('JSON', context);
const ToolCallError = vm.runInContext(
    '(class ToolCallError extends Error {' +
    '  constructor(message, code, toolName) { super(message); this.name = "ToolCallError"; this.code = code; this.toolName = toolName; }' +
    '})',
    context,
);

let nextCallId = 1;
const pending = new Map();

function errorText(err) {
    return err && typeof err.message === 'string' ? err.message : String(err);
}

parentPort.on('message', (msg) => {
    if (!msg || msg.type !== 'result') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (!msg.ok) {
        entry.reject(new ToolCallError(msg.error.message, msg.error.code, entry.name));
        return;
    }
    let value = msg.text;
    try { value = CtxJSON.parse(msg.text); } catch (_) { /* plain text result */ }
    entry.resolve(value);
});

function callTool(name, args) {
    return new CtxPromise((resolve, reject) => {
        const id = nextCallId++;
        try {
            parentPort.postMessage({ type: 'call', id: id, name: name, args: args === undefined ? {} : args });
        } catch (err) {
            reject(new ToolCallError('Arguments for ' + name + ' must be plain data: ' + errorText(err), 'TOOL_ERROR', name));
            return;
        }
        pending.set(id, { name: name, resolve: resolve, reject: reject });
    });
}

const known = new Set(workerData.toolNames);
const tools = new Proxy(Object.create(null), {
    get(_target, prop) {
        // Symbols and \`then\` stay undefined so \`await tools\` is harmless.
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (known.has(prop)) return (args) => callTool(prop, args);
        return () => CtxPromise.reject(new ToolCallError('Unknown tool: ' + prop, 'UNKNOWN_TOOL', prop));
    },
    has(_target, prop) { return typeof prop === 'string' && known.has(prop); },
    ownKeys() { return Array.from(known); },
    getOwnPropertyDescriptor(_target, prop) {
        return typeof prop === 'string' && known.has(prop)
            ? { value: (args) => callTool(prop, args), enumerable: true, configurable: true, writable: false }
            : undefined;
    },
    set() { return false; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
});

function formatLogArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error || (arg && typeof arg.stack === 'string' && typeof arg.message === 'string')) {
        return (arg.name || 'Error') + ': ' + arg.message;
    }
    try {
        const json = JSON.stringify(arg);
        return json === undefined ? String(arg) : json;
    } catch (_) {
        return String(arg);
    }
}

function makeLogger(level) {
    return (...args) => parentPort.postMessage({ type: 'log', level: level, text: args.map(formatLogArg).join(' ') });
}

context.tools = tools;
context.ToolCallError = ToolCallError;
context.console = Object.freeze({
    log: makeLogger('log'),
    info: makeLogger('info'),
    warn: makeLogger('warn'),
    error: makeLogger('error'),
});

function toError(err) {
    if (err && typeof err === 'object' && typeof err.message === 'string') {
        const out = { name: typeof err.name === 'string' ? err.name : 'Error', message: err.message };
        if (typeof err.code === 'string') out.code = err.code;
        return out;
    }
    return { name: 'Error', message: String(err) };
}

async function run() {
    let value;
    try {
        value = await vm.runInContext('(async () => {\\n' + workerData.code + '\\n})()', context);
    } catch (err) {
        return parentPort.postMessage({ type: 'done', ok: false, error: toError(err) });
    }
    if (value === undefined) {
        return parentPort.postMessage({ type: 'done', ok: true });
    }
    let json;
    try {
        json = CtxJSON.stringify(value);
    } catch (err) {
        json = undefined;
    }
    if (json === undefined) {
        return parentPort.postMessage({ type: 'done', ok: false, error: {
            name: 'ToolCallError', code: 'UNSERIALIZABLE_RESULT',
            message: 'The script returned a value that cannot be converted to JSON',
        } });
    }
    parentPort.postMessage({ type: 'done', ok: true, value: json });
}

run().catch((err) => {
    parentPort.postMessage({ type: 'done', ok: false, error: toError(err) });
});
`;
