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

/** The payload persisted into the `qaSidenoteRef` node (and thence the `.md`). */
export interface SidenoteRefPayload {
    /** Stable, markdown-safe id used for the `[^qa-<refId>]` footnote label. */
    refId: string;
    /** The question the user asked, if any (a default ask persists as absent). */
    question?: string;
    /** The frozen one-shot answer text. */
    answer: string;
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
                type: 'qaSidenoteRef',
                attrs: {
                    refId: payload.refId,
                    question: payload.question ?? null,
                    answer: payload.answer,
                },
            },
            { updateSelection: false },
        )
        .run();
    return true;
}
