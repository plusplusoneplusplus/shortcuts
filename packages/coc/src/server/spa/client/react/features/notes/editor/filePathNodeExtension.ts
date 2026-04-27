/**
 * filePathNodeExtension — Tiptap inline Node for file-path references.
 *
 * Renders file paths (e.g. `tasks/coc/foo.plan.md`) as styled chip spans
 * inside the editor. Parsed from `<span class="file-ref-link" data-file-path="...">`.
 * Round-tripped through noteMarkdown.ts (markdownToHtml / htmlToMarkdown).
 *
 * Paste support: `addPasteRules` converts pasted plain-text file paths
 * into filePathRef nodes.
 */

import { Node, mergeAttributes, nodePasteRule } from '@tiptap/core';

/** Known extensions for file-path detection. */
const FILE_PATH_EXTENSIONS = 'md|ts|tsx|js|jsx|json|yaml|yml|txt|py|go|sh|rs|css|html';

/**
 * Regex that matches `path/to/file.ext` in pasted text.
 * Requires at least one `/` separator and a known extension.
 * Negative lookbehind prevents matching inside URLs or other link contexts.
 */
export const FILE_PATH_PASTE_RE = new RegExp(
    `(?<![a-zA-Z0-9/:@#."'])([a-zA-Z0-9_.-]+(?:\\/[a-zA-Z0-9_.-]+)+\\.(?:${FILE_PATH_EXTENSIONS}))`,
    'g',
);

/**
 * Derive a display label from a file path.
 * Returns the file basename (last segment).
 */
export function filePathLabel(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
}

export const FilePathNodeExtension = Node.create({
    name: 'filePathRef',
    inline: true,
    group: 'inline',
    atom: true,

    addAttributes() {
        return {
            filePath: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-file-path'),
                renderHTML: (attrs) => ({ 'data-file-path': attrs.filePath }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'span.file-ref-link' }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const label = node.attrs.filePath ?? '';
        return ['span', mergeAttributes(HTMLAttributes, { class: 'file-ref-link' }), label];
    },

    addPasteRules() {
        return [
            nodePasteRule({
                find: FILE_PATH_PASTE_RE,
                type: this.type,
                getAttributes: (match) => ({
                    filePath: match[1],
                }),
            }),
        ];
    },
});
