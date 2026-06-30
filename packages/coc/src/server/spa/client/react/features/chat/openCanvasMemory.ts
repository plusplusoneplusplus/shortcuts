/**
 * Session-scoped, per-conversation memory of which canvas surface is currently
 * open in a chat (restore-open-canvas-on-chat-switch).
 *
 * The docked right panel shows AT MOST one canvas surface at a time — the AI
 * agent canvas, a source-file / note / folder canvas (all carried by a single
 * `SourceCanvasFileRef`, discriminated by its `kind`), or a transient
 * whisper-diff. This module models that single open surface as one descriptor so
 * `ChatDetail` can snapshot it when the user switches away from a chat and
 * reopen the SAME surface when they switch back — instead of force-closing every
 * non-agent canvas as the chat-switch reset used to.
 *
 * IMPORTANT: this memory is HELD IN MEMORY ONLY (a `useRef` map keyed by
 * `pid = processId ?? bareTaskId`). It is intentionally NOT written to
 * `localStorage` or disk, so it is forgotten on a full page reload/restart. The
 * separate deliberate-close flag (`canvasClosedPreference` /
 * `coc.canvasPanel.closed.*`) is the only persisted piece and always wins over a
 * restore.
 */
import type { SourceCanvasFileRef } from './source-canvas';
import type { WhisperDiffOpenContext } from './conversation/tool-calls/WhisperCollapsedGroup';

/**
 * The single open canvas surface remembered for a chat, or `null` for the
 * explicit "nothing open" state (e.g. after the user closes a source/note/
 * folder/whisper-diff canvas). A chat with no record at all (never visited /
 * untouched) is represented by the ABSENCE of a map entry — distinct from a
 * `null` record — so the discovery effect's default auto-open only applies to
 * truly-untouched chats.
 */
export type OpenCanvasMemory =
    | { kind: 'agent'; canvasId: string }
    | { kind: 'source'; fileRef: SourceCanvasFileRef }
    | { kind: 'whisper-diff'; ctx: WhisperDiffOpenContext }
    | null;

/** The live canvas state `deriveOpenCanvasMemory` reads to build a descriptor. */
export interface OpenCanvasState {
    /** The active AI agent canvas id, or `null` when none is discovered/open. */
    activeCanvasId: string | null;
    /** Whether the agent canvas panel is collapsed (deliberate close / mutual exclusion). */
    canvasPanelClosed: boolean;
    /** The open source/note/folder canvas reference, or `null`. */
    sourceFileRef: SourceCanvasFileRef | null;
    /** The open whisper-diff context, or `null`. */
    whisperDiffCtx: WhisperDiffOpenContext | null;
}

/**
 * Derive the single open-canvas descriptor from the live canvas state.
 *
 * Surfaces are mutually exclusive in the docked panel, so the order encodes the
 * "front" surface: an open source/whisper panel always sits over the (collapsed)
 * agent canvas, so it wins; the agent canvas counts as open only when it is
 * actually expanded (`activeCanvasId` set and NOT collapsed). Everything else is
 * "nothing open" (`null`).
 */
export function deriveOpenCanvasMemory(state: OpenCanvasState): OpenCanvasMemory {
    if (state.sourceFileRef) {
        return { kind: 'source', fileRef: state.sourceFileRef };
    }
    if (state.whisperDiffCtx) {
        return { kind: 'whisper-diff', ctx: state.whisperDiffCtx };
    }
    if (state.activeCanvasId && !state.canvasPanelClosed) {
        return { kind: 'agent', canvasId: state.activeCanvasId };
    }
    return null;
}
