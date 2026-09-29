/**
 * Decides which diff engine a working-tree file renders with, and why the
 * classic viewer is used when the user asked for the editor.
 *
 * Pure: the surface feeds in the preference, the stage, the content-load
 * state and whether the editor itself failed; the result drives both the
 * viewer choice and the fallback banner.
 */

import type { DiffEngine } from '../hooks/useDiffEngine';

/** Why the editor was asked for but the classic viewer is shown. */
export type DiffEngineFallbackReason = 'binary' | 'tooLarge' | 'loadFailed' | 'editorFailed';

/**
 * When several reasons apply, the first one in this list wins. Content flags
 * come first because they describe the file itself and retrying cannot
 * change them.
 */
export const FALLBACK_REASON_PRECEDENCE: readonly DiffEngineFallbackReason[] = [
    'binary',
    'tooLarge',
    'loadFailed',
    'editorFailed',
];

export const FALLBACK_REASON_MESSAGE: Record<DiffEngineFallbackReason, string> = {
    binary: 'Binary file — showing the classic diff.',
    tooLarge: 'File too large for the editor view — showing the classic diff.',
    loadFailed: 'Could not load the file for the editor view — showing the classic diff.',
    editorFailed: 'The editor view failed to start — showing the classic diff.',
};

/** Reasons a fresh attempt could fix. */
export function isRetryableFallback(reason: DiffEngineFallbackReason): boolean {
    return reason === 'loadFailed' || reason === 'editorFailed';
}

export type DiffContentLoadState =
    | { status: 'loading' }
    | { status: 'loaded'; binary: boolean; tooLarge: boolean }
    | { status: 'failed' };

export interface DiffEngineResolutionInput {
    preference: DiffEngine;
    stage: 'staged' | 'unstaged' | 'untracked';
    /** Content for the current file and attempt; `null` before the first request. */
    content: DiffContentLoadState | null;
    /** The editor reported an error for the current file and attempt. */
    editorFailed: boolean;
}

export type DiffEngineResolution =
    | { engine: 'monaco' }
    | { engine: 'loading' }
    | { engine: 'legacy'; fallback: DiffEngineFallbackReason | null };

export function resolveDiffEngineSelection(input: DiffEngineResolutionInput): DiffEngineResolution {
    // The user chose Classic, or the stage has no two-sided diff: not a fallback.
    if (input.preference !== 'monaco' || input.stage === 'untracked') {
        return { engine: 'legacy', fallback: null };
    }
    const { content } = input;
    if (!content || content.status === 'loading') return { engine: 'loading' };

    const reasons = new Set<DiffEngineFallbackReason>();
    if (content.status === 'failed') reasons.add('loadFailed');
    if (content.status === 'loaded' && content.binary) reasons.add('binary');
    if (content.status === 'loaded' && content.tooLarge) reasons.add('tooLarge');
    if (input.editorFailed) reasons.add('editorFailed');

    const fallback = FALLBACK_REASON_PRECEDENCE.find(reason => reasons.has(reason));
    // A deleted file (head missing) renders against an empty modified side.
    return fallback ? { engine: 'legacy', fallback } : { engine: 'monaco' };
}
