/**
 * One-shot AI invocation helper for Quick Ask side-notes.
 *
 * Mirrors `invokeCommentAI` but forwards an optional model so the lookup can
 * honor the per-repo model preference. Non-streaming, short timeout — a cheap
 * side-question, never a follow-up turn.
 */

/** Timeout for a side-note lookup (ms). Kept short — this is a cheap ask. */
export const SIDENOTE_AI_TIMEOUT_MS = 60000;

/**
 * Invoke the CLI AI invoker with a prompt and optional model.
 *
 * Returns `{ success: false, unavailable: true }` when the AI service cannot be
 * reached (map to HTTP 503); `{ success: false, unavailable: false }` when the
 * service responded with a failure (map to HTTP 502).
 */
export async function invokeSideNoteAI(
    prompt: string,
    model?: string,
): Promise<
    | { success: true; response: string }
    | { success: false; error: string; unavailable: boolean }
> {
    try {
        const { createCLIAIInvoker } = await import('../../../ai-invoker');
        const invoker = createCLIAIInvoker({ approvePermissions: false, model });
        const result = await invoker(prompt, { timeoutMs: SIDENOTE_AI_TIMEOUT_MS });
        if (!result.success) {
            return { success: false, error: result.error || 'AI request failed', unavailable: false };
        }
        return { success: true, response: result.response || '' };
    } catch {
        return { success: false, error: 'AI service unavailable', unavailable: true };
    }
}
