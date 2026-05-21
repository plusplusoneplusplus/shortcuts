/**
 * IndentExtension — adds indent/outdent commands for paragraph and heading nodes.
 *
 * Stores the indentation level as a `data-indent` attribute on the node.
 * Visual padding is applied via CSS in noteEditor.css.
 *
 * Tab / Shift-Tab trigger increase/decrease indent only when the cursor is
 * not inside a list item (where Tiptap's default Tab behaviour applies).
 */

import { Extension } from '@tiptap/core';

export const MAX_INDENT = 8;
export const INDENT_TYPES = ['paragraph', 'heading'];

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
                types: INDENT_TYPES,
                attributes: {
                    indent: {
                        default: 0,
                        parseHTML: (el) => {
                            const raw = el.getAttribute('data-indent');
                            if (!raw) return 0;
                            const n = parseInt(raw, 10);
                            return Number.isFinite(n) ? Math.max(0, Math.min(n, MAX_INDENT)) : 0;
                        },
                        renderHTML: (attrs) => {
                            const n = attrs.indent;
                            if (!n || n <= 0) return {};
                            return { 'data-indent': String(n) };
                        },
                    },
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
