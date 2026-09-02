/**
 * Backs `host.complete(prompt, { model? })` inside an async extension-canvas
 * capability with the same one-shot invoker the Quick Ask side-notes use
 * (`createCLIAIInvoker` with `approvePermissions: false` and a timeout). No new
 * LLM path is introduced here — this is a thin, attributed wrapper.
 *
 * `host.complete` is exposed CAPABILITY-SIDE ONLY. There is deliberately no
 * `CanvasHost.complete()` in the iframe: a browser-side completion would
 * produce state the server never gated, and it would split rate limiting and
 * logging across two places. The iframe loses nothing — it can already reach
 * the model by invoking a capability that calls `host.complete`.
 *
 * Every call is logged with the workspace, canvas, capability and owning
 * process, because a completion an artifact triggered on its own is otherwise
 * invisible: it appears in no conversation transcript.
 */

import type { CapabilityCompleteFn, CapabilityCompletionRequest } from './canvas-capability-runner';
import { resolveDefaultModel } from '../preferences/repository';

/** Wall clock for one `host.complete` call. Under the 30 s run budget on purpose. */
export const CANVAS_COMPLETE_TIMEOUT_MS = 25_000;

/** Ceiling on a single prompt, so one call cannot ship the whole canvas state. */
export const MAX_CANVAS_COMPLETE_PROMPT_CHARS = 24_000;

/** Who a completion belongs to. Every field is known at the call site. */
export interface CanvasCompletionAttribution {
    workspaceId: string;
    canvasId: string;
    capability: string;
    /** Conversation that owns the canvas, when it has one. */
    processId?: string;
}

/** Seams for tests — neither is used in production. */
export interface CanvasCompletionDeps {
    /** Replaces the real one-shot AI invocation. */
    invoke?: (prompt: string, model?: string) => Promise<{ success: true; response: string } | { success: false; error: string }>;
    log?: (message: string) => void;
}

/**
 * The default invocation: the CLI one-shot invoker, imported lazily so a server
 * that never runs an async capability never pays for loading the SDK stack.
 */
async function invokeOneShot(
    prompt: string,
    model?: string,
): Promise<{ success: true; response: string } | { success: false; error: string }> {
    try {
        const { createCLIAIInvoker } = await import('../../ai-invoker');
        const invoker = createCLIAIInvoker({ approvePermissions: false, ...(model ? { model } : {}) });
        const result = await invoker(prompt, { timeoutMs: CANVAS_COMPLETE_TIMEOUT_MS });
        if (!result.success) {
            return { success: false, error: result.error || 'AI request failed' };
        }
        return { success: true, response: result.response || '' };
    } catch {
        return { success: false, error: 'AI service unavailable' };
    }
}

/**
 * Build the `host.complete` implementation for one capability run.
 *
 * Model resolution follows the per-repo preference (`quickAsk` mode, the same
 * "cheap side question" class of call), unless the capability names a model
 * itself.
 */
export function createCanvasCompleteFn(
    dataDir: string,
    attribution: CanvasCompletionAttribution,
    deps: CanvasCompletionDeps = {},
): CapabilityCompleteFn {
    const invoke = deps.invoke ?? invokeOneShot;
    const log = deps.log ?? ((message: string) => console.log(message));

    return async (request: CapabilityCompletionRequest) => {
        const prompt = typeof request.prompt === 'string' ? request.prompt : '';
        if (!prompt.trim()) {
            return { ok: false, code: 'capability-error', error: 'host.complete needs a non-empty prompt' };
        }
        if (prompt.length > MAX_CANVAS_COMPLETE_PROMPT_CHARS) {
            return {
                ok: false,
                code: 'capability-error',
                error: `host.complete prompt is ${prompt.length} characters, over the ${MAX_CANVAS_COMPLETE_PROMPT_CHARS} limit`,
            };
        }

        let model = request.model;
        if (!model) {
            try {
                model = resolveDefaultModel(dataDir, attribution.workspaceId, 'quickAsk');
            } catch {
                model = undefined;
            }
        }

        log(
            `[canvas] host.complete workspace=${attribution.workspaceId} canvas=${attribution.canvasId} `
            + `capability=${attribution.capability} process=${attribution.processId ?? 'none'} `
            + `model=${model ?? 'default'} promptChars=${prompt.length}`,
        );

        const result = await invoke(prompt, model);
        return result.success
            ? { ok: true, text: result.response }
            : { ok: false, code: 'capability-error', error: result.error };
    };
}
