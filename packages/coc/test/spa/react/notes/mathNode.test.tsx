// @vitest-environment jsdom
/**
 * AC-02 — Tiptap formula node views.
 *
 * Covers parseHTML/renderHTML for both `mathInline` and `mathDisplay`, and the
 * shared NodeView's editing behavior: mouse + keyboard opening, live preview,
 * Apply, Cancel/Escape, and invalid-TeX reporting without losing the draft.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ── Mocks (mirror mermaidBlock.test.tsx) ──────────────────────────────────────

vi.mock('@tiptap/core', () => ({
    Node: { create: (config: unknown) => config },
    mergeAttributes: (...objs: Array<Record<string, unknown>>) => Object.assign({}, ...objs),
}));

vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({
        as: As = 'div',
        children,
        ...props
    }: React.PropsWithChildren<{ as?: string } & Record<string, unknown>>) =>
        React.createElement(As, props, children),
    ReactNodeViewRenderer: (component: unknown) => component,
}));

import {
    MathInline,
    MathDisplay,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mathNode';

// ── Helpers ────────────────────────────────────────────────────────────────

type ExtensionConfig = {
    parseHTML(): Array<{ tag: string; getAttrs: (el: HTMLElement) => Record<string, unknown> }>;
    renderHTML(args: { node: { attrs: Record<string, unknown> }; HTMLAttributes: Record<string, unknown> }): unknown[];
    addNodeView(): React.FC<any>;
};

const inlineConfig = MathInline as unknown as ExtensionConfig;
const displayConfig = MathDisplay as unknown as ExtensionConfig;
const MathNodeView = inlineConfig.addNodeView() as React.FC<any>;

function makeProps(opts: {
    tex: string;
    display?: boolean;
    delimiter?: string;
    selected?: boolean;
    updateAttributes?: (attrs: Record<string, unknown>) => void;
}) {
    const { tex, display = false, delimiter, selected = false, updateAttributes = vi.fn() } = opts;
    return {
        node: {
            type: { name: display ? 'mathDisplay' : 'mathInline' },
            attrs: { tex, delimiter: delimiter ?? (display ? 'double-dollar' : 'dollar') },
        },
        updateAttributes,
        selected,
    } as any;
}

afterEach(() => cleanup());

// ── parseHTML ────────────────────────────────────────────────────────────────

describe('MathInline / MathDisplay parseHTML', () => {
    it('inline node parses tex + delimiter from a data-math span', () => {
        const el = document.createElement('span');
        el.setAttribute('data-math', 'inline');
        el.setAttribute('data-tex', 'E=mc^2');
        el.setAttribute('data-delim', 'dollar');
        const [rule] = inlineConfig.parseHTML();
        expect(rule.tag).toBe('span[data-math="inline"]');
        expect(rule.getAttrs(el)).toEqual({ tex: 'E=mc^2', delimiter: 'dollar' });
    });

    it('display node parses tex + delimiter from a data-math div', () => {
        const el = document.createElement('div');
        el.setAttribute('data-math', 'display');
        el.setAttribute('data-tex', '\\int x');
        el.setAttribute('data-delim', 'bracket');
        const [rule] = displayConfig.parseHTML();
        expect(rule.tag).toBe('div[data-math="display"]');
        expect(rule.getAttrs(el)).toEqual({ tex: '\\int x', delimiter: 'bracket' });
    });

    it('coerces an unknown delimiter to a form-appropriate default', () => {
        const el = document.createElement('span');
        el.setAttribute('data-tex', 'x');
        const [rule] = inlineConfig.parseHTML();
        expect(rule.getAttrs(el)).toEqual({ tex: 'x', delimiter: 'dollar' });
    });
});

// ── renderHTML ─────────────────────────────────────────────────────────────

describe('MathInline / MathDisplay renderHTML', () => {
    it('inline renders a data-math span carrying tex text + delimiter', () => {
        const result = inlineConfig.renderHTML({
            node: { attrs: { tex: 'a+b', delimiter: 'dollar' } },
            HTMLAttributes: {},
        });
        expect(result[0]).toBe('span');
        expect(result[1]).toMatchObject({ 'data-math': 'inline', 'data-delim': 'dollar' });
        expect(result[2]).toBe('a+b');
    });

    it('display renders a data-math div', () => {
        const result = displayConfig.renderHTML({
            node: { attrs: { tex: 'z', delimiter: 'bracket' } },
            HTMLAttributes: {},
        });
        expect(result[0]).toBe('div');
        expect(result[1]).toMatchObject({ 'data-math': 'display', 'data-delim': 'bracket' });
    });
});

// ── NodeView ─────────────────────────────────────────────────────────────────

describe('MathNodeView', () => {
    it('renders KaTeX markup for a valid formula', () => {
        render(<MathNodeView {...makeProps({ tex: 'E=mc^2' })} />);
        expect(document.querySelector('.katex')).not.toBeNull();
    });

    it('opens the inline editor on click, seeded with the exact source', () => {
        render(<MathNodeView {...makeProps({ tex: 'E=mc^2' })} />);
        expect(screen.queryByLabelText('Formula TeX source')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        const input = screen.getByLabelText('Formula TeX source') as HTMLTextAreaElement;
        expect(input.value).toBe('E=mc^2');
    });

    it('opens the editor via keyboard (Enter on the rendered formula)', () => {
        render(<MathNodeView {...makeProps({ tex: 'x' })} />);
        fireEvent.keyDown(screen.getByRole('button', { name: /Edit formula/ }), { key: 'Enter' });
        expect(screen.getByLabelText('Formula TeX source')).not.toBeNull();
    });

    it('live-previews the draft as the user types', () => {
        render(<MathNodeView {...makeProps({ tex: 'a' })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        const input = screen.getByLabelText('Formula TeX source');
        fireEvent.change(input, { target: { value: '\\alpha' } });
        // KaTeX renders \alpha as a MathML annotation carrying its source.
        const preview = document.querySelector('.math-node-render');
        expect(preview?.querySelector('annotation')?.textContent).toBe('\\alpha');
    });

    it('Apply commits the edited TeX via updateAttributes and closes', () => {
        const updateAttributes = vi.fn();
        render(<MathNodeView {...makeProps({ tex: 'a', updateAttributes })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        fireEvent.change(screen.getByLabelText('Formula TeX source'), { target: { value: 'b^2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(updateAttributes).toHaveBeenCalledWith({ tex: 'b^2' });
        expect(screen.queryByLabelText('Formula TeX source')).toBeNull();
    });

    it('Cancel discards the draft without committing', () => {
        const updateAttributes = vi.fn();
        render(<MathNodeView {...makeProps({ tex: 'a', updateAttributes })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        fireEvent.change(screen.getByLabelText('Formula TeX source'), { target: { value: 'zzz' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(updateAttributes).not.toHaveBeenCalled();
        // Reopen — the draft was discarded, so it shows the original source again.
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        expect((screen.getByLabelText('Formula TeX source') as HTMLTextAreaElement).value).toBe('a');
    });

    it('Escape cancels the editor', () => {
        const updateAttributes = vi.fn();
        render(<MathNodeView {...makeProps({ tex: 'a', updateAttributes })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        fireEvent.keyDown(screen.getByLabelText('Formula TeX source'), { key: 'Escape' });
        expect(screen.queryByLabelText('Formula TeX source')).toBeNull();
        expect(updateAttributes).not.toHaveBeenCalled();
    });

    it('Enter applies for an inline formula', () => {
        const updateAttributes = vi.fn();
        render(<MathNodeView {...makeProps({ tex: 'a', updateAttributes })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        fireEvent.change(screen.getByLabelText('Formula TeX source'), { target: { value: 'q' } });
        fireEvent.keyDown(screen.getByLabelText('Formula TeX source'), { key: 'Enter' });
        expect(updateAttributes).toHaveBeenCalledWith({ tex: 'q' });
    });

    it('reports invalid TeX without losing the draft', () => {
        render(<MathNodeView {...makeProps({ tex: 'a' })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        const input = screen.getByLabelText('Formula TeX source');
        fireEvent.change(input, { target: { value: '\\frac{1}{' } });
        expect(document.querySelector('.math-node-editor-error')?.textContent).toContain('Invalid TeX');
        // Draft is preserved (not cleared) so the user can fix it.
        expect((input as HTMLTextAreaElement).value).toBe('\\frac{1}{');
    });

    it('renders a display formula in a block wrapper', () => {
        render(<MathNodeView {...makeProps({ tex: '\\int x', display: true })} />);
        expect(document.querySelector('.math-node--display')).not.toBeNull();
        expect(document.querySelector('.katex-display')).not.toBeNull();
    });

    it('display editor requires a modifier for Enter to apply', () => {
        const updateAttributes = vi.fn();
        render(<MathNodeView {...makeProps({ tex: 'a', display: true, updateAttributes })} />);
        fireEvent.click(screen.getByRole('button', { name: /Edit formula/ }));
        const input = screen.getByLabelText('Formula TeX source');
        fireEvent.change(input, { target: { value: 'b' } });
        // Plain Enter inserts a newline; it must NOT apply.
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(updateAttributes).not.toHaveBeenCalled();
        // Cmd/Ctrl+Enter applies.
        fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
        expect(updateAttributes).toHaveBeenCalledWith({ tex: 'b' });
    });

    it('marks the wrapper selected when the node is selected', () => {
        render(<MathNodeView {...makeProps({ tex: 'a', selected: true })} />);
        expect(document.querySelector('.math-node--selected')).not.toBeNull();
    });

    it('syncs the rendered formula when tex changes externally (undo/redo/AI edit)', () => {
        const { rerender } = render(<MathNodeView {...makeProps({ tex: 'a' })} />);
        rerender(<MathNodeView {...makeProps({ tex: '\\beta' })} />);
        const preview = document.querySelector('.math-node-render');
        expect(preview?.querySelector('annotation')?.textContent).toBe('\\beta');
    });
});

// Keep `act` referenced for React 18 warnings suppression parity with sibling tests.
void act;
