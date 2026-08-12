/**
 * Shared one-shot AI invocation helper.
 *
 * A one-shot lookup is stateless and grounded: a single prompt, no session
 * resume, no follow-up, no tools, and every permission request denied. Several
 * features need exactly that — Quick Ask side-notes, comment drafting, canvas
 * capability completion — and each used to hand-roll the same wrapper around
 * `createCLIAIInvoker`, whose MCP default is tuned for agentic work and so
 * started ambient MCP servers for requests that can never use them.
 *
 * This module owns the one contract. Text-only asks route through the SDK's
 * `transform` primitive, which already owns the right isolation defaults. Asks
 * that carry attachments cannot use `transform` (it takes none), so they fall
 * back to the invoker with MCP explicitly disabled. Both branches are MCP-free
 * and permission-denied, so callers see one behaviour.
 */

import type { Attachment } from '@plusplusoneplusplus/forge';

/** Timeout for a one-shot lookup (ms). Kept short — this is a cheap ask. */
export const ONE_SHOT_AI_TIMEOUT_MS = 60000;

/** Options for {@link invokeOneShotAI}. */
export interface OneShotAIOptions {
    /** Model to use; omitted means the provider default. */
    model?: string;
    /** Per-call timeout in ms. Defaults to {@link ONE_SHOT_AI_TIMEOUT_MS}. */
    timeoutMs?: number;
    /**
     * File/image attachments to include with the prompt. Present attachments
     * select the invoker path, since `transform` accepts none. The caller owns
     * the lifetime of the attached files.
     */
    attachments?: Attachment[];
}

/**
 * Result of a one-shot lookup.
 *
 * `unavailable: true` means the AI service could not be reached at all (no
 * provider registered, import failure) — callers map it to HTTP 503.
 * `unavailable: false` means the provider responded with a failure — HTTP 502.
 */
export type OneShotAIResult =
    | { success: true; response: string }
    | { success: false; error: string; unavailable: boolean };

/**
 * Run a single stateless, tool-free, permission-denied AI lookup.
 */
export async function invokeOneShotAI(
    prompt: string,
    options: OneShotAIOptions = {},
): Promise<OneShotAIResult> {
    const timeoutMs = options.timeoutMs ?? ONE_SHOT_AI_TIMEOUT_MS;
    const attachments = options.attachments;

    try {
        // Attachment path: `transform` takes no attachments, so use the invoker
        // with MCP explicitly off rather than inheriting its agentic default.
        if (attachments && attachments.length > 0) {
            const { createCLIAIInvoker } = await import('../../ai-invoker');
            const invoker = createCLIAIInvoker({
                approvePermissions: false,
                model: options.model,
                attachments,
                loadMcpConfig: false,
            });
            const result = await invoker(prompt, { timeoutMs });
            if (!result.success) {
                return { success: false, error: result.error || 'AI request failed', unavailable: false };
            }
            return { success: true, response: result.response || '' };
        }

        // Lazy-import forge so a server that never asks never loads the SDK stack.
        const { sdkServiceRegistry, SDK_PROVIDER_COPILOT } = await import('@plusplusoneplusplus/forge');
        const service = sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
        const result = await service.transform(prompt, { model: options.model, timeoutMs });
        if (!result.success) {
            return { success: false, error: result.error || 'AI request failed', unavailable: false };
        }
        return { success: true, response: result.text || '' };
    } catch {
        return { success: false, error: 'AI service unavailable', unavailable: true };
    }
}
