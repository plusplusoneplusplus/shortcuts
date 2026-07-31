/**
 * mathNode — Tiptap formula nodes for the rich Markdown editor.
 *
 * Two atom nodes carry a formula's exact source without ever persisting rendered
 * markup:
 *
 *   - `mathInline`  — inline atom, parsed from `<span data-math="inline">`
 *   - `mathDisplay` — block atom,  parsed from `<div data-math="display">`
 *
 * Both store `{ tex, delimiter }` and render KaTeX at runtime through the shared
 * safe `renderMath` policy. Clicking a formula opens an inline TeX editor seeded
 * with the exact source; edits preview live, Apply commits, Cancel/Escape
 * restores the draft, and invalid TeX is reported without losing the draft.
 *
 * Serialization back to Markdown is handled by turndown rules in noteMarkdown.ts
 * that read the same data attributes — see `mathNodeMarked.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { renderMath, getMathError } from '../../../../../shared/math/renderMath';
import type { MathDelimiter } from '../../../../../shared/math/mathTokenizer';
import { createIndentAttribute } from './indentShared';

const DELIMITERS: MathDelimiter[] = ['dollar', 'double-dollar', 'paren', 'bracket'];

function coerceDelimiter(value: unknown, display: boolean): MathDelimiter {
    if (typeof value === 'string' && (DELIMITERS as string[]).includes(value)) {
        return value as MathDelimiter;
    }
    return display ? 'double-dollar' : 'dollar';
}

// KaTeX prefixes every parse error with a verbose "KaTeX parse error: " and
// often a trailing "at position N: …" pointer. Trim the boilerplate prefix so
// the inline hint reads as a plain, actionable reason.
function formatMathError(message: string): string {
    return message.replace(/^KaTeX parse error:\s*/i, '').trim() || 'Invalid TeX';
}

// Size the TeX textarea to its content so the source is never clipped: inline
// math grows its width to the longest line (bounded), display math grows its
// row count. Pure string math — no DOM measurement, so it stays testable.
const INLINE_MIN_CH = 12;
const INLINE_MAX_CH = 60;
const DISPLAY_MIN_ROWS = 3;
const DISPLAY_MAX_ROWS = 12;

function textareaSizing(draft: string, display: boolean): { rows: number; widthCh?: number } {
    const lines = draft.split('\n');
    if (display) {
        const rows = Math.min(DISPLAY_MAX_ROWS, Math.max(DISPLAY_MIN_ROWS, lines.length));
        return { rows };
    }
    const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
    const widthCh = Math.min(INLINE_MAX_CH, Math.max(INLINE_MIN_CH, longest + 1));
    return { rows: 1, widthCh };
}

// ── Shared React NodeView ─────────────────────────────────────────────────────

function MathNodeView({ node, updateAttributes, selected }: NodeViewProps) {
    const display = node.type.name === 'mathDisplay';
    const tex: string = node.attrs.tex ?? '';
    const indent = display ? Number(node.attrs.indent || 0) : 0;

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(tex);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Keep the draft in sync when the underlying formula changes externally
    // (AI-applied edits, undo/redo) while the editor is closed.
    useEffect(() => {
        if (!editing) setDraft(tex);
    }, [tex, editing]);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    // While editing, the formula rerenders live from the draft so the user sees
    // changes as they type; otherwise it shows the committed source.
    const activeTex = editing ? draft : tex;
    const renderedHtml = useMemo(() => renderMath(activeTex, { display }), [activeTex, display]);
    const draftError = useMemo(
        () => (editing && draft.trim().length > 0 ? getMathError(draft, { display }) : null),
        [editing, draft, display],
    );
    const sizing = useMemo(() => textareaSizing(draft, display), [draft, display]);
    // Discoverability: spell out the apply/cancel chords right in the editor.
    const applyHint = display ? '⌘/Ctrl+Enter to apply' : 'Enter to apply';

    const openEditor = useCallback(() => {
        setDraft(tex);
        setEditing(true);
    }, [tex]);

    const apply = useCallback(() => {
        updateAttributes({ tex: draft });
        setEditing(false);
    }, [draft, updateAttributes]);

    const cancel = useCallback(() => {
        setDraft(tex);
        setEditing(false);
    }, [tex]);

    const onKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
                return;
            }
            // Enter applies for inline; Cmd/Ctrl+Enter applies for display
            // (where a bare Enter should insert a newline into the TeX).
            const applyChord = display ? event.metaKey || event.ctrlKey : !event.shiftKey;
            if (event.key === 'Enter' && applyChord) {
                event.preventDefault();
                apply();
            }
        },
        [apply, cancel, display],
    );

    const wrapperClass = [
        'math-node',
        display ? 'math-node--display' : 'math-node--inline',
        selected ? 'math-node--selected' : '',
        editing ? 'math-node--editing' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <NodeViewWrapper
            as={display ? 'div' : 'span'}
            className={wrapperClass}
            data-math={display ? 'display' : 'inline'}
            data-indent={indent > 0 ? indent : undefined}
        >
            <span
                className="math-node-render"
                role="button"
                tabIndex={0}
                aria-label={`Edit formula: ${tex}`}
                title="Click to edit formula"
                onClick={openEditor}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openEditor();
                    }
                }}
                // renderMath output is produced under the fixed trust:false policy.
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
            {editing && (
                <span className="math-node-editor" contentEditable={false}>
                    <textarea
                        ref={inputRef}
                        className="math-node-editor-input"
                        aria-label="Formula TeX source"
                        placeholder={display ? 'TeX source, e.g. \\int_0^1 x\\,dx' : 'TeX, e.g. \\frac{a}{b}'}
                        spellCheck={false}
                        rows={sizing.rows}
                        style={sizing.widthCh ? { width: `${sizing.widthCh}ch` } : undefined}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                    />
                    <span className="math-node-editor-actions">
                        <button
                            type="button"
                            className="math-node-editor-btn math-node-editor-apply"
                            onClick={apply}
                        >
                            Apply
                        </button>
                        <button
                            type="button"
                            className="math-node-editor-btn math-node-editor-cancel"
                            onClick={cancel}
                        >
                            Cancel
                        </button>
                    </span>
                    {draftError ? (
                        <span className="math-node-editor-error" role="alert" title={draftError}>
                            {formatMathError(draftError)}
                        </span>
                    ) : (
                        <span className="math-node-editor-hint">{applyHint} · Esc to cancel</span>
                    )}
                </span>
            )}
        </NodeViewWrapper>
    );
}

// ── Node factory ──────────────────────────────────────────────────────────────

function buildAttributes() {
    return {
        tex: {
            default: '',
            parseHTML: (el: HTMLElement) => el.getAttribute('data-tex') ?? '',
            renderHTML: (attrs: { tex?: string }) => ({ 'data-tex': attrs.tex ?? '' }),
        },
        delimiter: {
            default: null as MathDelimiter | null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-delim'),
            renderHTML: (attrs: { delimiter?: MathDelimiter | null }) => ({ 'data-delim': attrs.delimiter ?? '' }),
        },
    };
}

export const MathInline = Node.create({
    name: 'mathInline',
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,

    addAttributes() {
        return buildAttributes();
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-math="inline"]',
                getAttrs: (el: HTMLElement) => ({
                    tex: el.getAttribute('data-tex') ?? '',
                    delimiter: coerceDelimiter(el.getAttribute('data-delim'), false),
                }),
            },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        // The TeX is emitted as text content (in addition to `data-tex`) so the
        // serialized HTML is not a blank node that turndown would drop before
        // the math serialization rule runs.
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                'data-math': 'inline',
                'data-delim': coerceDelimiter(node.attrs.delimiter, false),
            }),
            node.attrs.tex ?? '',
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(MathNodeView);
    },
});

export const MathDisplay = Node.create({
    name: 'mathDisplay',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        // Block display math opts into the shared embed indentation contract;
        // inline math is not a block and stays without an indent attribute.
        return { ...buildAttributes(), indent: createIndentAttribute() };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-math="display"]',
                getAttrs: (el: HTMLElement) => ({
                    tex: el.getAttribute('data-tex') ?? '',
                    delimiter: coerceDelimiter(el.getAttribute('data-delim'), true),
                }),
            },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        return [
            'div',
            mergeAttributes(HTMLAttributes, {
                'data-math': 'display',
                'data-delim': coerceDelimiter(node.attrs.delimiter, true),
            }),
            node.attrs.tex ?? '',
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(MathNodeView);
    },
});
