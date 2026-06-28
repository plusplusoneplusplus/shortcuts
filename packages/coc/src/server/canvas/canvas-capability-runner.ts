/**
 * Canvas Capability Runner
 *
 * Executes extension-canvas capabilities — pure `(state, params) => nextState`
 * functions authored as part of an extension canvas — against the canvas's
 * JSON shared state.
 *
 * The capability script runs in a fresh `node:vm` context with no require,
 * no process, and a wall-clock timeout. This matches CoC's local trust model
 * (the same trust level as AI-authored shell commands in autopilot): the vm
 * context prevents accidental host-state coupling, it is not a hard security
 * boundary.
 *
 * Script contract: the extension's `capabilities.js` assigns a top-level
 * `capabilities` object whose values are synchronous functions taking
 * `(state, params)` and returning the complete next state object.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vm from 'vm';

const CAPABILITY_TIMEOUT_MS = 1000;
const MAX_STATE_BYTES = 1024 * 1024;

export type CapabilityRunResult =
    | { ok: true; state: string }
    | { ok: false; error: string };

export const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidCapabilityName(name: string): boolean {
    return typeof name === 'string' && CAPABILITY_NAME_PATTERN.test(name);
}

/**
 * Run one capability against the canvas state.
 *
 * @param capabilitiesJs - The extension's capability script (assigns `capabilities = {...}`).
 * @param capability - Name of the capability to invoke.
 * @param stateJson - Current canvas content (JSON shared state; empty = `{}`).
 * @param params - Caller-provided parameters (AI tool call or UI action).
 */
export function runCanvasCapability(
    capabilitiesJs: string,
    capability: string,
    stateJson: string,
    params: unknown,
): CapabilityRunResult {
    if (!isValidCapabilityName(capability)) {
        return { ok: false, error: 'Invalid capability name' };
    }

    let state: unknown;
    try {
        state = stateJson.trim() ? JSON.parse(stateJson) : {};
    } catch {
        return { ok: false, error: 'Canvas state is not valid JSON — fix it with write_canvas first' };
    }

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

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
