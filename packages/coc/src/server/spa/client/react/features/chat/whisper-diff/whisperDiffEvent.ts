/**
 * whisperDiffEvent — the window CustomEvent bridge that opens the transient
 * whisper diff panel (AC-03).
 *
 * `WhisperCollapsedGroup` lives several levels deep in the conversation render
 * tree (ChatDetail → ConversationArea → ConversationTurnBubble → group), so —
 * exactly like the source-canvas `coc-open-source-canvas` event — the files
 * popover dispatches its `WhisperDiffOpenContext` on `window` instead of
 * threading an `onOpenFileDiff` callback through every intermediate prop.
 * `ChatDetail` listens for the event and opens the docked panel.
 *
 * The detail is the live `WhisperDiffOpenContext` object (carrying the captured
 * tool calls + the group's ordered files, plus an optional `focusPath`), so
 * dispatch must be synchronous within the same window — no structured clone is
 * involved.
 */
import type { WhisperDiffOpenContext } from '../conversation/tool-calls/WhisperCollapsedGroup';

export const WHISPER_DIFF_EVENT = 'coc-open-whisper-diff';

/**
 * Dispatch a request to open the converged whisper diff panel — from the "N
 * files" footer (no `focusPath` → All files) or a file row (`focusPath` set →
 * focused on that file). Both ride the same event + docked slot; opening one
 * replaces whatever the dock currently shows.
 */
export function dispatchOpenWhisperDiff(ctx: WhisperDiffOpenContext): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(WHISPER_DIFF_EVENT, { detail: ctx }));
}
