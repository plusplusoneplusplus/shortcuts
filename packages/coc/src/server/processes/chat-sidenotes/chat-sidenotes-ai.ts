/**
 * One-shot AI invocation helpers for Quick Ask side-notes.
 *
 * Both are thin adapters over the shared {@link invokeOneShotAI} helper, which
 * owns the isolation contract (no MCP servers, no tools, permissions denied).
 * The exported names and signatures are the injection seams used by the
 * side-note and quick-ask handlers, so they stay stable.
 */

import { invokeOneShotAI, ONE_SHOT_AI_TIMEOUT_MS, type OneShotAIResult } from '../../core/one-shot-ai';

/** Timeout for a side-note lookup (ms). Kept short — this is a cheap ask. */
export const SIDENOTE_AI_TIMEOUT_MS = ONE_SHOT_AI_TIMEOUT_MS;

/**
 * Injectable vision invoker signature (overridable in tests).
 *
 * Same success/failure contract as {@link SideNoteAIInvoke} but carries a list
 * of local image file paths to attach to the one-shot lookup — used by the
 * figure/equation region-crop path (Goal 4 AC-01).
 */
export type SideNoteVisionInvoke = (
    prompt: string,
    imagePaths: string[],
    model?: string,
) => Promise<OneShotAIResult>;

/**
 * Run a side-note lookup with a prompt and optional model.
 *
 * Returns `{ success: false, unavailable: true }` when the AI service cannot be
 * reached (map to HTTP 503); `{ success: false, unavailable: false }` when the
 * service responded with a failure (map to HTTP 502).
 */
export async function invokeSideNoteAI(
    prompt: string,
    model?: string,
): Promise<OneShotAIResult> {
    return invokeOneShotAI(prompt, { model, timeoutMs: SIDENOTE_AI_TIMEOUT_MS });
}

/**
 * Run a side-note lookup with a prompt and one or more image attachments.
 *
 * Mirrors {@link invokeSideNoteAI} but attaches the given local image files to
 * the message so a vision-capable model can read a cropped figure/equation
 * region (Goal 4 AC-01). The caller owns the lifetime of the image files
 * (temp files written + cleaned up around the call).
 */
export async function invokeSideNoteVisionAI(
    prompt: string,
    imagePaths: string[],
    model?: string,
): Promise<OneShotAIResult> {
    const attachments = imagePaths.map((filePath, i) => ({
        type: 'file' as const,
        path: filePath,
        displayName: `region-${i}.png`,
    }));
    return invokeOneShotAI(prompt, { model, timeoutMs: SIDENOTE_AI_TIMEOUT_MS, attachments });
}
