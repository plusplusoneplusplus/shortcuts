/**
 * sidenoteRefExtension — Tiptap inline atom for a Quick Ask side-note reference
 * marker (Goal: notes-quick-ask, AC-03 persistence; AC-04 will layer the chip
 * popover on top).
 *
 * The marker round-trips through the note `.md` in footnote form
 * (`[^qa-<id>]` + a bottom definition block) via {@link ../noteMarkdown} and the
 * helpers in {@link ./sidenoteFootnote}. This node is the payload-carrying atom:
 * it parses `<span class="qa-sidenote-ref" data-qa-id data-qa-question
 * data-qa-answer>` and re-emits exactly the same attributes so the answer text
 * survives an edit/save cycle. Modelled on the `noteLink` atom (payload
 * preserved on the element), never the `comment` mark (payload stripped).
 *
 * The node must be registered whenever a note that could contain footnotes is
 * loaded — even with the Quick Ask flag off — otherwise Tiptap would drop the
 * unknown span and destroy the persisted side-note on the next save. Creating
 * new markers stays gated by the flag in the layer, not here.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { QA_MARKER_GLYPH, QA_SIDENOTE_REF_CLASS } from './sidenoteFootnote';

export const SidenoteRefExtension = Node.create({
    name: 'qaSidenoteRef',
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
});
