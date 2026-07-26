/**
 * sidenoteRefExtension — Tiptap inline atom for a Quick Ask side-note reference
 * marker (Goal: notes-quick-ask, AC-03 persistence; AC-04 will layer the chip
 * popover on top).
 *
 * The marker round-trips through the note `.md` in footnote form
 * (`[^qa-<id>]` + a bottom definition block) via {@link ../noteMarkdown} and the
 * helpers in {@link ./sidenoteFootnote}. This node is the payload-carrying atom:
 * it parses the marker's id, question, answer, and optional selection-anchor
 * data attributes and re-emits them so the payload survives an edit/save
 * cycle. Its ProseMirror plugin resolves persisted anchors against the current
 * document and renders non-serialized dotted-underline decorations.
 *
 * The node must be registered whenever a note that could contain footnotes is
 * loaded — even with the Quick Ask flag off — otherwise Tiptap would drop the
 * unknown span and destroy the persisted side-note on the next save. Creating
 * new markers stays gated by the flag in the layer, not here.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findAnchorInDoc, posToTextOffset, textOffsetToPos } from '../commentAnchoring';
import { QA_MARKER_GLYPH, QA_SIDENOTE_REF_CLASS } from './sidenoteFootnote';

/** ProseMirror node name for the Quick Ask reference marker atom. Shared so
 * placement/deletion helpers locate the node without a magic string. */
export const QA_SIDENOTE_NODE_NAME = 'qaSidenoteRef';
export const QA_SIDENOTE_ANCHOR_CLASS = 'note-quick-ask-anchor';
export const sidenoteAnchorPluginKey =
    new PluginKey<DecorationSet>('qaSidenoteAnchorDecoration');

interface PersistedSidenoteAnchor {
    selectedText?: unknown;
    contextBefore?: unknown;
    contextAfter?: unknown;
}

function contextScore(
    fullText: string,
    start: number,
    selectedLength: number,
    contextBefore: string,
    contextAfter: string,
): number {
    let score = 0;
    const before = fullText.slice(Math.max(0, start - contextBefore.length), start);
    const after = fullText.slice(start + selectedLength, start + selectedLength + contextAfter.length);
    if (contextBefore) {
        if (before === contextBefore) score += 2;
        else if (before.endsWith(contextBefore.slice(-10))) score += 1;
    }
    if (contextAfter) {
        if (after === contextAfter) score += 2;
        else if (after.startsWith(contextAfter.slice(0, 10))) score += 1;
    }
    return score;
}

/**
 * Resolve one persisted side-note anchor in the current document. The normal
 * Notes anchor matcher supplies the content match; the marker position breaks
 * repeated-text ties in favor of the occurrence associated with this chip.
 */
export function resolveSidenoteAnchorRange(
    doc: ProseMirrorNode,
    markerPos: number,
    attrs: PersistedSidenoteAnchor,
): { from: number; to: number } | null {
    const selectedText = typeof attrs.selectedText === 'string' ? attrs.selectedText : '';
    if (
        !selectedText ||
        typeof attrs.contextBefore !== 'string' ||
        typeof attrs.contextAfter !== 'string'
    ) return null;
    const contextBefore = attrs.contextBefore;
    const contextAfter = attrs.contextAfter;
    const anchor = { quotedText: selectedText, prefix: contextBefore, suffix: contextAfter };
    const normalMatch = findAnchorInDoc(doc, anchor);
    if (!normalMatch) return null;

    const fullText = doc.textContent;
    const offsets: number[] = [];
    let searchFrom = 0;
    while (true) {
        const offset = fullText.indexOf(selectedText, searchFrom);
        if (offset < 0) break;
        offsets.push(offset);
        searchFrom = offset + 1;
    }
    if (offsets.length === 1) return normalMatch;

    const markerTextOffset = posToTextOffset(doc, markerPos);
    const candidates = offsets
        .map((offset) => {
            const from = textOffsetToPos(doc, offset);
            const to = textOffsetToPos(doc, offset + selectedText.length);
            return {
                from,
                to,
                endOffset: offset + selectedText.length,
                score: contextScore(
                    fullText,
                    offset,
                    selectedText.length,
                    contextBefore,
                    contextAfter,
                ),
            };
        })
        .filter((candidate) => candidate.endOffset <= markerTextOffset);

    const adjacent = candidates.find((candidate) => candidate.to === markerPos);
    if (adjacent) return { from: adjacent.from, to: adjacent.to };
    if (candidates.length === 0) return null;

    candidates.sort((a, b) =>
        b.score - a.score || (markerPos - a.to) - (markerPos - b.to),
    );
    if (candidates[0].score === 0) return null;
    return { from: candidates[0].from, to: candidates[0].to };
}

export function buildSidenoteAnchorDecorations(doc: ProseMirrorNode): DecorationSet {
    const decorations: Decoration[] = [];
    const seenRanges = new Set<string>();
    doc.descendants((node, pos) => {
        if (node.type.name !== QA_SIDENOTE_NODE_NAME) return true;
        const range = resolveSidenoteAnchorRange(doc, pos, node.attrs);
        if (!range || range.from >= range.to) return false;
        const key = `${range.from}:${range.to}`;
        if (seenRanges.has(key)) return false;
        seenRanges.add(key);
        decorations.push(
            Decoration.inline(
                range.from,
                range.to,
                { class: QA_SIDENOTE_ANCHOR_CLASS },
                { inclusiveStart: false, inclusiveEnd: false },
            ),
        );
        return false;
    });
    return DecorationSet.create(doc, decorations);
}

export const SidenoteRefExtension = Node.create({
    name: QA_SIDENOTE_NODE_NAME,
    inline: true,
    group: 'inline',
    atom: true,

    addAttributes() {
        return {
            refId: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-qa-id'),
                renderHTML: (attrs) => (attrs.refId ? { 'data-qa-id': attrs.refId } : {}),
            },
            question: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-qa-question') || null,
                renderHTML: (attrs) =>
                    attrs.question ? { 'data-qa-question': attrs.question } : {},
            },
            answer: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-qa-answer') ?? '',
                renderHTML: (attrs) =>
                    attrs.answer != null ? { 'data-qa-answer': attrs.answer } : {},
            },
            selectedText: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-qa-selected-text') || null,
                renderHTML: (attrs) =>
                    attrs.selectedText
                        ? { 'data-qa-selected-text': attrs.selectedText }
                        : {},
            },
            contextBefore: {
                default: null,
                parseHTML: (el: HTMLElement) =>
                    el.hasAttribute('data-qa-context-before')
                        ? el.getAttribute('data-qa-context-before')
                        : null,
                renderHTML: (attrs) =>
                    attrs.contextBefore != null
                        ? { 'data-qa-context-before': attrs.contextBefore }
                        : {},
            },
            contextAfter: {
                default: null,
                parseHTML: (el: HTMLElement) =>
                    el.hasAttribute('data-qa-context-after')
                        ? el.getAttribute('data-qa-context-after')
                        : null,
                renderHTML: (attrs) =>
                    attrs.contextAfter != null
                        ? { 'data-qa-context-after': attrs.contextAfter }
                        : {},
            },
        };
    },

    parseHTML() {
        return [{ tag: `span.${QA_SIDENOTE_REF_CLASS}` }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(HTMLAttributes, { class: QA_SIDENOTE_REF_CLASS }),
            QA_MARKER_GLYPH,
        ];
    },

    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: sidenoteAnchorPluginKey,
                state: {
                    init(_, state) {
                        return buildSidenoteAnchorDecorations(state.doc);
                    },
                    apply(tr, decorations, _oldState, newState) {
                        return tr.docChanged
                            ? buildSidenoteAnchorDecorations(newState.doc)
                            : decorations;
                    },
                },
                props: {
                    decorations(state) {
                        return sidenoteAnchorPluginKey.getState(state) ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});
