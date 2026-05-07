/**
 * noteLinkExtension — Tiptap inline Node for `[[note:...]]` wiki-links.
 *
 * Renders note links as clickable chip-styled spans inside the editor.
 * Parsed from `<span class="note-link" data-note-path="..." data-note-heading="...">`.
 * Round-tripped through noteMarkdown.ts (markdownToHtml / htmlToMarkdown).
 *
 * Paste support: `addPasteRules` converts pasted plain-text `[[note:...]]`
 * patterns into noteLink nodes so "Copy Link → paste in rich mode" works.
 */

import { Node, mergeAttributes, nodePasteRule } from '@tiptap/core';

/** Create a regex that matches `[[note:path]]` or `[[note:path#heading]]` in pasted text. */
export const NOTE_LINK_PASTE_RE = () => /\[\[(?:[^\]|]+\|)?note:([^\]#]+?)(?:#([^\]]*))?\]\]/g;

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

    addPasteRules() {
        return [
            nodePasteRule({
                find: NOTE_LINK_PASTE_RE(),
                type: this.type,
                getAttributes: (match) => ({
                    path: match[1],
                    heading: match[2] || null,
                }),
            }),
        ];
    },
});
