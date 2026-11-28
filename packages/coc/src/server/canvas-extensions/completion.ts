interface ExtensionCompletionRequest { prompt: string; model?: string }
type ExtensionCompleteFn = (request: ExtensionCompletionRequest) => Promise<{ ok: true; text: string } | { ok: false; error: string; code?: string }>;

import { resolveDefaultModel } from '../preferences/repository';

/** Wall clock for one `ephemeralQuery` call. Under the 30 s run budget on purpose. */
export const CANVAS_COMPLETE_TIMEOUT_MS = 25_000;

/** Ceiling on a single prompt, so one call cannot ship the whole canvas state. */
export const MAX_CANVAS_COMPLETE_PROMPT_CHARS = 24_000;

/** Who a completion belongs to. Every field is known at the call site. */
export interface CanvasCompletionAttribution {
    workspaceId: string;
    extensionKey: string;
    operation: string;
    /** Conversation that owns the canvas, when it has one. */
    processId?: string;
}

/** Invocation, logging and model-policy overrides for conversation-bound callers and tests. */
export interface CanvasCompletionDeps {
    /** Replaces the real one-shot AI invocation. */
    invoke?: (prompt: string, model?: string) => Promise<{ success: true; response: string } | { success: false; error: string }>;
    log?: (message: string) => void;
    /** Conversation-bound callers supply their model policy instead of the quick-ask default. */
    defaultModel?: () => string | undefined;
}

/**
 * The default invocation: the CLI one-shot invoker, imported lazily so a server
 * that never runs an async operation never pays for loading the SDK stack.
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
 * Build the `ephemeralQuery` implementation for one operation run.
 *
 * Model resolution follows the caller's policy or the per-repo `quickAsk`
 * preference, unless the operation names a model itself.
 */
export function createExtensionCompleteFn(
    dataDir: string,
    attribution: CanvasCompletionAttribution,
    deps: CanvasCompletionDeps = {},
): ExtensionCompleteFn {
    const invoke = deps.invoke ?? invokeOneShot;
    const log = deps.log ?? ((message: string) => console.log(message));

    return async (request: ExtensionCompletionRequest) => {
        const prompt = typeof request.prompt === 'string' ? request.prompt : '';
        if (!prompt.trim()) {
            return { ok: false, code: 'operation-error', error: 'ephemeralQuery needs a non-empty prompt' };
        }
        if (prompt.length > MAX_CANVAS_COMPLETE_PROMPT_CHARS) {
            return {
                ok: false,
                code: 'operation-error',
                error: `ephemeralQuery prompt is ${prompt.length} characters, over the ${MAX_CANVAS_COMPLETE_PROMPT_CHARS} limit`,
            };
        }

        let model = request.model;
        if (!model && deps.defaultModel) {
            model = deps.defaultModel();
        } else if (!model) {
            try {
                model = resolveDefaultModel(dataDir, attribution.workspaceId, 'quickAsk');
            } catch {
                model = undefined;
            }
        }

        log(
            `[canvas-extension] ephemeralQuery workspace=${attribution.workspaceId} canvas=${attribution.extensionKey} `
            + `operation=${attribution.operation} process=${attribution.processId ?? 'none'} `
            + `model=${model ?? 'default'} promptChars=${prompt.length}`,
        );

        const result = await invoke(prompt, model);
        return result.success
            ? { ok: true, text: result.response }
            : { ok: false, code: 'operation-error', error: result.error };
    };
}
