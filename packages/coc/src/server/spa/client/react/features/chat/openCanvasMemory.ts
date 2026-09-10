/**
 * Session-scoped, per-conversation memory of which side view is currently open
 * in a chat (restore-open-canvas-on-chat-switch).
 *
 * The chat's own side area shows AT MOST one view at a time — a source-file /
 * note / folder canvas (all carried by a single `SourceCanvasFileRef`,
 * discriminated by its `kind`) or a transient whisper-diff. This module models
 * that single open view as one descriptor so `ChatDetail` can snapshot it when
 * the user switches away from a chat and reopen the SAME view when they switch
 * back — instead of force-closing it as the chat-switch reset used to.
 *
 * AI canvases are deliberately absent: they are tabs in the shared right panel,
 * restored by that panel's own persistence, so nothing here can suppress or
 * resurrect one.
 *
 * IMPORTANT: this memory is HELD IN MEMORY ONLY (a `useRef` map keyed by
 * `pid = processId ?? bareTaskId`). It is intentionally NOT written to
 * `localStorage` or disk, so it is forgotten on a full page reload/restart.
 */
import type { SourceCanvasFileRef } from './source-canvas';
import type { WhisperDiffOpenContext } from './conversation/tool-calls/WhisperCollapsedGroup';

/**
 * The single open view remembered for a chat, or `null` for the explicit
 * "nothing open" state (e.g. after the user closes a source/note/folder/
 * whisper-diff canvas). A chat with no record at all (never visited) is
 * represented by the ABSENCE of a map entry — distinct from a `null` record,
 * though both now open nothing.
 */
export type OpenCanvasMemory =
    | { kind: 'source'; fileRef: SourceCanvasFileRef }
    | { kind: 'whisper-diff'; ctx: WhisperDiffOpenContext }
    | null;

/** The live state `deriveOpenCanvasMemory` reads to build a descriptor. */
export interface OpenCanvasState {
    /** The open source/note/folder canvas reference, or `null`. */
    sourceFileRef: SourceCanvasFileRef | null;
    /** The open whisper-diff context, or `null`. */
    whisperDiffCtx: WhisperDiffOpenContext | null;
}

/**
 * Derive the single open-view descriptor from the live state.
 *
 * The two views are mutually exclusive in the chat's side area, so the order
 * only matters for a transient overlap during a switch: a source canvas wins.
 * Everything else is "nothing open" (`null`).
 */
export function deriveOpenCanvasMemory(state: OpenCanvasState): OpenCanvasMemory {
    if (state.sourceFileRef) {
        return { kind: 'source', fileRef: state.sourceFileRef };
    }
    if (state.whisperDiffCtx) {
        return { kind: 'whisper-diff', ctx: state.whisperDiffCtx };
    }
    return null;
}
