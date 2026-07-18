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

const DELIMITERS: MathDelimiter[] = ['dollar', 'double-dollar', 'paren', 'bracket'];

function coerceDelimiter(value: unknown, display: boolean): MathDelimiter {
    if (typeof value === 'string' && (DELIMITERS as string[]).includes(value)) {
        return value as MathDelimiter;
    }
    return display ? 'double-dollar' : 'dollar';
}

// ── Shared React NodeView ─────────────────────────────────────────────────────

function MathNodeView({ node, updateAttributes, selected }: NodeViewProps) {
    const display = node.type.name === 'mathDisplay';
    const tex: string = node.attrs.tex ?? '';

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
    const previewInvalid = draftError !== null;

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
                        rows={display ? 3 : 1}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                    />
                    {previewInvalid && (
                        <span className="math-node-editor-error" role="alert">
                            Invalid TeX
                        </span>
                    )}
                    <span className="math-node-editor-actions">
                        <button type="button" className="math-node-editor-apply" onClick={apply}>
                            Apply
                        </button>
                        <button type="button" className="math-node-editor-cancel" onClick={cancel}>
                            Cancel
                        </button>
                    </span>
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
        return buildAttributes();
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
