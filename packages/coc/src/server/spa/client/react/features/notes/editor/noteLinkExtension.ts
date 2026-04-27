/**
 * noteLinkExtension — Tiptap inline Node for `[[note:...]]` wiki-links.
 *
 * Renders note links as clickable chip-styled spans inside the editor.
 * Parsed from `<span class="note-link" data-note-path="..." data-note-heading="...">`.
 * Round-tripped through noteMarkdown.ts (markdownToHtml / htmlToMarkdown).
 */

import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Derive a display label from a note path.
 * Strips the `.md` extension and returns only the file basename.
 */
export function noteLinkLabel(path: string, heading?: string | null): string {
    const basename = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
    return heading ? `${basename} § ${heading}` : basename;
}

export const NoteLinkExtension = Node.create({
    name: 'noteLink',
    inline: true,
    group: 'inline',
    atom: true,

    addAttributes() {
        return {
            path: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-note-path'),
                renderHTML: (attrs) => ({ 'data-note-path': attrs.path }),
            },
            heading: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-note-heading') || null,
                renderHTML: (attrs) => attrs.heading ? { 'data-note-heading': attrs.heading } : {},
            },
        };
    },

    parseHTML() {
        return [{ tag: 'span.note-link' }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const label = noteLinkLabel(node.attrs.path ?? '', node.attrs.heading);
        return ['span', mergeAttributes(HTMLAttributes, { class: 'note-link' }), label];
    },
});
