/**
 * IndentExtension — adds indent/outdent commands for the indentable block nodes.
 *
 * Stores the indentation level as a `data-indent` attribute on the node.
 * Visual padding is applied via CSS in noteEditor.css.
 *
 * Two families of nodes share the SAME indentation contract:
 *   - Text blocks (`paragraph`, `heading`) carry `indent` as a Tiptap *global*
 *     attribute added here.
 *   - Block-level visual embeds (`image`, `pdfBlock`, `mapBlock`,
 *     `mermaidBlock`, `mathDisplay`) declare their own `indent` attribute via
 *     the shared `createIndentAttribute()` helper so parsing, clamping, and
 *     rendering can never drift from the text blocks.
 *
 * The commands operate on every name in `INDENT_TYPES`.
 *
 * Tab / Shift-Tab trigger increase/decrease indent only when the cursor is
 * not inside a list item (where Tiptap's default Tab behaviour applies).
 */

import { Extension } from '@tiptap/core';
import {
    INDENT_TYPES,
    MAX_INDENT,
    TEXT_INDENT_TYPES,
    createIndentAttribute,
} from './indentShared';

// Re-export the shared primitives so existing importers of this module keep
// working. The framework-free definitions live in `indentShared.ts`.
export {
    MAX_INDENT,
    INDENT_TYPES,
    TEXT_INDENT_TYPES,
    EMBED_INDENT_TYPES,
    clampIndent,
    parseIndentAttr,
    renderIndentAttr,
    createIndentAttribute,
} from './indentShared';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        indent: {
            increaseIndent: () => ReturnType;
            decreaseIndent: () => ReturnType;
        };
    }
}

export const IndentExtension = Extension.create({
    name: 'indent',

    addGlobalAttributes() {
        return [
            {
                types: TEXT_INDENT_TYPES,
                attributes: {
                    indent: createIndentAttribute(),
                },
            },
        ];
    },

    addCommands() {
        return {
            increaseIndent:
                () =>
                ({ tr, state, dispatch }) => {
                    const { from, to } = state.selection;
                    let changed = false;
                    state.doc.nodesBetween(from, to, (node, pos) => {
                        if (!INDENT_TYPES.includes(node.type.name)) return;
                        const current = (node.attrs.indent as number) ?? 0;
                        if (current >= MAX_INDENT) return;
                        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: current + 1 });
                        changed = true;
                    });
                    if (changed && dispatch) dispatch(tr);
                    return changed;
                },

            decreaseIndent:
                () =>
                ({ tr, state, dispatch }) => {
                    const { from, to } = state.selection;
                    let changed = false;
                    state.doc.nodesBetween(from, to, (node, pos) => {
                        if (!INDENT_TYPES.includes(node.type.name)) return;
                        const current = (node.attrs.indent as number) ?? 0;
                        if (current <= 0) return;
                        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: current - 1 });
                        changed = true;
                    });
                    if (changed && dispatch) dispatch(tr);
                    return changed;
                },
        };
    },

    addKeyboardShortcuts() {
        return {
            Tab: ({ editor }) => {
                if (editor.isActive('listItem') || editor.isActive('taskItem')) return false;
                return editor.commands.increaseIndent();
            },
            'Shift-Tab': ({ editor }) => {
                if (editor.isActive('listItem') || editor.isActive('taskItem')) return false;
                return editor.commands.decreaseIndent();
            },
        };
    },
});
