/**
 * Shared AI invocation helper for comment handlers.
 *
 * Both task-comments-handler and diff-comments-handler use nearly identical
 * code to invoke the CLI AI invoker. This module centralises that pattern.
 */

/**
 * Invoke the CLI AI invoker with a prompt and return the result.
 *
 * Returns `{ success: false, error, unavailable: true }` when the AI service
 * cannot be reached (import failure, thrown exception) — callers should map
 * this to HTTP 503.  Returns `{ success: false, error }` (unavailable=false)
 * when the service responded with a failure — callers should map to HTTP 502.
 */
export async function invokeCommentAI(
    prompt: string
): Promise<
    | { success: true; response: string }
    | { success: false; error: string; unavailable: boolean }
> {
    try {
        const { createCLIAIInvoker } = await import('../../../ai-invoker');
        const invoker = createCLIAIInvoker({ approvePermissions: false });
        const result = await invoker(prompt, { timeoutMs: 60000 });
        if (!result.success) {
            return { success: false, error: result.error || 'AI request failed', unavailable: false };
        }
        return { success: true, response: result.response || '' };
    } catch {
        return { success: false, error: 'AI service unavailable', unavailable: true };
    }
}
