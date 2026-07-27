/**
 * sidenoteRefPlacement — insert an answered Quick Ask side-note into the live
 * TipTap document as a `qaSidenoteRef` marker at its anchor phrase
 * (Goal: notes-quick-ask, AC-03 wiring; the AC-05 pending-drop falls out for
 * free — see below).
 *
 * Generation is non-blocking: the user keeps editing while the answer is in
 * flight, so by the time it returns the captured selection may have moved (text
 * typed before it) or vanished (phrase deleted). Rather than remember a raw
 * ProseMirror position and try to map it forward, we re-resolve the anchor
 * against the *current* document at answer time, reusing the same
 * {@link findAnchorInDoc} matcher the notes comment system uses. If the phrase
 * can no longer be located the marker is simply not inserted — which is exactly
 * the AC-05 "pending drop" behaviour (no chip, and since the definition block is
 * rebuilt from markers on save, no dangling definition either).
 *
 * The marker is placed at the END of the matched phrase (`match.to`), so
 * `[^qa-<id>]` reads as a trailing footnote reference on the source phrase.
 */

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { findAnchorInDoc } from '../commentAnchoring';
import type { TextAnchor } from '../textAnchor';
import { encodeQaTurns, type QaTurn } from './sidenoteFootnote';
import { QA_SIDENOTE_NODE_NAME } from './sidenoteRefExtension';

/** The payload persisted into the `qaSidenoteRef` node (and thence the `.md`). */
export interface SidenoteRefPayload {
    /** Stable, markdown-safe id used for the `[^qa-<refId>]` footnote label. */
    refId: string;
    /** The question the user asked, if any (a default ask persists as absent). */
    question?: string;
    /** The frozen one-shot answer text. */
    answer: string;
    /**
     * The full multi-turn thread to persist on the marker's `data-qa-turns`
     * attribute (AC-03). Omitted → only the turn-0 `question`/`answer` mirror is
     * written (back-compat with a plain one-shot ask).
     */
    turns?: QaTurn[];
}

/** The anchor phrase + its surrounding window, as captured at ask time. */
export interface SidenoteAnchorInput {
    selectedText: string;
    contextBefore?: string;
    contextAfter?: string;
}

function toTextAnchor(anchor: SidenoteAnchorInput): TextAnchor {
    return {
        quotedText: anchor.selectedText ?? '',
        prefix: anchor.contextBefore ?? '',
        suffix: anchor.contextAfter ?? '',
    };
}

/**
 * Resolve the ProseMirror position at which the reference marker should sit for
 * `anchor` in the current `doc` — the position just after the matched phrase —
 * or `null` when the phrase can no longer be located (deleted during
 * generation → pending drop).
 */
export function resolveSidenoteInsertPos(
    doc: ProseMirrorNode,
    anchor: SidenoteAnchorInput,
): number | null {
    if (!anchor.selectedText) return null;
    const match = findAnchorInDoc(doc, toTextAnchor(anchor));
    return match ? match.to : null;
}

/**
 * Insert a `qaSidenoteRef` marker after the anchored phrase in `editor`.
 *
 * Returns `true` when the marker was inserted, `false` when the phrase could not
 * be located (the note is dropped — AC-05) or the editor is unavailable. The
 * user's selection is left untouched (`updateSelection: false`) so an in-flight
 * answer landing does not yank the caret while they keep typing.
 */
export function insertSidenoteRef(
    editor: Editor | null | undefined,
    anchor: SidenoteAnchorInput,
    payload: SidenoteRefPayload,
): boolean {
    if (!editor || editor.isDestroyed) return false;
    const pos = resolveSidenoteInsertPos(editor.state.doc, anchor);
    if (pos == null) return false;
    editor
        .chain()
        .insertContentAt(
            pos,
            {
                type: QA_SIDENOTE_NODE_NAME,
                attrs: {
                    refId: payload.refId,
                    question: payload.question ?? null,
                    answer: payload.answer,
                    turns:
                        payload.turns && payload.turns.length
                            ? encodeQaTurns(payload.turns)
                            : null,
                    selectedText: anchor.selectedText,
                    contextBefore: anchor.contextBefore ?? '',
                    contextAfter: anchor.contextAfter ?? '',
                },
            },
            { updateSelection: false },
        )
        .run();
    return true;
}

/**
 * Re-write the `turns` (and turn-0 `question`/`answer` mirror) attributes of the
 * `qaSidenoteRef` marker with `refId` so a follow-up thread is persisted into the
 * live document — and thence the `.md` on the next save (AC-03). The marker is
 * inserted turn-0-only by {@link insertSidenoteRef}; each subsequent follow-up
 * answer folds the accumulated ready turns back onto the same marker here.
 *
 * Returns `true` when a matching marker was found and updated, `false` when the
 * editor is unavailable, `turns` is empty, or no marker with that id exists
 * (e.g. the anchor phrase was deleted so the marker was never embedded — the
 * in-session thread still updates, only persistence is skipped).
 */
export function updateSidenoteRefTurns(
    editor: Editor | null | undefined,
    refId: string,
    turns: QaTurn[],
): boolean {
    if (!editor || editor.isDestroyed || !refId || turns.length === 0) return false;
    const { state, view } = editor;
    const targets: Array<{ pos: number; node: ProseMirrorNode }> = [];
    state.doc.descendants((node, pos) => {
        if (node.type.name === QA_SIDENOTE_NODE_NAME && node.attrs.refId === refId) {
            targets.push({ pos, node });
            return false;
        }
        return true;
    });
    if (targets.length === 0) return false;
    const { pos, node } = targets[0];
    const first = turns[0];
    view.dispatch(
        state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            turns: encodeQaTurns(turns),
            question: first.question ?? null,
            answer: first.answer,
        }),
    );
    return true;
}

/**
 * Delete the `qaSidenoteRef` marker with `refId` from the live TipTap document
 * (AC-04 chip delete control). Removing the node removes both the inline
 * `[^qa-<id>]` marker and — since the definition block is rebuilt from markers
 * on save — its bottom definition, so both vanish from the `.md` on the next
 * save (AC-04 DoD#3).
 *
 * Returns `true` when a matching marker was found and deleted, `false` when the
 * editor is unavailable or no marker with that id exists (e.g. the note was
 * still `asking`/`error` and never embedded, or a manual edit already removed
 * it — a harmless no-op).
 */
export function deleteSidenoteRef(
    editor: Editor | null | undefined,
    refId: string,
): boolean {
    if (!editor || editor.isDestroyed || !refId) return false;
    const { state, view } = editor;
    // Collect matches rather than assigning to a closed-over local (which
    // TypeScript's flow analysis can't narrow through the closure). The marker is
    // an atom, so there is at most one node per id; take the first.
    const targets: Array<{ from: number; to: number }> = [];
    state.doc.descendants((node, pos) => {
        if (node.type.name === QA_SIDENOTE_NODE_NAME && node.attrs.refId === refId) {
            targets.push({ from: pos, to: pos + node.nodeSize });
            return false;
        }
        return true;
    });
    if (targets.length === 0) return false;
    const { from, to } = targets[0];
    view.dispatch(state.tr.delete(from, to));
    return true;
}
