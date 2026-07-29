/**
 * NotesCodeBlock — CodeBlockLowlight + a per-block language picker (AC-02).
 *
 * Extends the shared `CodeBlockLowlight` node with a React NodeView that renders
 * the editable `<pre><code>` plus a small language `<select>` in the block's
 * top-right corner. The select lists "Plain text" and the 16 registered
 * languages (NOTES_CODE_LANGUAGES); choosing one writes the node's `language`
 * attribute (re-highlighting live via the lowlight decorations), and "Plain
 * text" clears it (→ null → no highlighting). A new block created from the
 * toolbar toggle has no language, so it starts as "Plain text".
 *
 * The select is hidden by default and revealed on hover / focus-within by the
 * `.notes-code-block-*` rules in noteEditor.css. The `<code>` content, its
 * `.hljs-*` token spans, and the markdown `class="language-<lang>"` round-trip
 * are all unchanged from the base extension — only the editing chrome is added.
 */

import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { NOTES_CODE_LANGUAGES } from './notesLowlight';

// ── React NodeView ───────────────────────────────────────────────────────────

/**
 * NodeView for a fenced code block. Renders the language picker + the editable
 * code content. Exported for unit testing the picker behaviour in isolation.
 */
export function CodeBlockLanguageView({ node, updateAttributes }: NodeViewProps) {
    // `node.attrs.language` is the highlight.js grammar name, or null for a plain
    // block. Empty-string is the "Plain text" option's value.
    const language: string = node.attrs.language ?? '';

    return (
        <NodeViewWrapper className="notes-code-block">
            <select
                className="notes-code-block-lang"
                contentEditable={false}
                aria-label="Code block language"
                value={language}
                // A native <select> inside ProseMirror must not let its clicks /
                // key events reach the editor selection machinery.
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                    const next = event.target.value;
                    // "" (Plain text) clears the attribute so the block renders
                    // plain; any of the 16 grammar names highlights the block.
                    updateAttributes({ language: next === '' ? null : next });
                }}
            >
                <option value="">Plain text</option>
                {NOTES_CODE_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                        {lang.label}
                    </option>
                ))}
            </select>
            <pre>
                <NodeViewContent as="code" />
            </pre>
        </NodeViewWrapper>
    );
}

// ── TipTap Extension ─────────────────────────────────────────────────────────

/**
 * CodeBlockLowlight with the language-picker NodeView. Keep the base node name
 * (`codeBlock`) so parse/serialize, the toolbar toggle, and the markdown
 * `class="language-<lang>"` round-trip behave exactly as before — only the live
 * editing DOM gains the picker.
 */
export const NotesCodeBlock = CodeBlockLowlight.extend({
    addNodeView() {
        return ReactNodeViewRenderer(CodeBlockLanguageView);
    },
});
