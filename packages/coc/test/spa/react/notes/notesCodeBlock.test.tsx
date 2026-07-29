import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

// Render NodeView primitives as plain elements so the picker can be exercised
// without a live ProseMirror editor. `ReactNodeViewRenderer` is an identity so
// the extension's addNodeView() returns the component directly.
vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({
        children,
        ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
    NodeViewContent: ({ as: As = 'div', ...props }: { as?: string } & Record<string, unknown>) =>
        React.createElement(As, props),
    ReactNodeViewRenderer: (component: unknown) => component,
}));

// Capture the config passed to CodeBlockLowlight.extend so the NodeView wiring
// can be asserted without pulling in the real extension.
vi.mock('@tiptap/extension-code-block-lowlight', () => ({
    CodeBlockLowlight: {
        extend: (config: any) => ({ ...config, name: 'codeBlock' }),
    },
}));

import {
    CodeBlockLanguageView,
    NotesCodeBlock,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/notesCodeBlock';
import { NOTES_CODE_LANGUAGES } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/notesLowlight';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProps(language: string | null) {
    const updateAttributes = vi.fn();
    const props = {
        node: { attrs: { language } },
        updateAttributes,
    } as any;
    return { props, updateAttributes };
}

afterEach(() => cleanup());

// ── Language picker ────────────────────────────────────────────────────────

describe('CodeBlockLanguageView language picker', () => {
    it('lists "Plain text" plus the 16 supported languages', () => {
        const { props } = makeProps(null);
        render(<CodeBlockLanguageView {...props} />);

        const select = screen.getByLabelText('Code block language') as HTMLSelectElement;
        const options = Array.from(select.options).map((o) => o.textContent);

        expect(options[0]).toBe('Plain text');
        expect(options).toHaveLength(NOTES_CODE_LANGUAGES.length + 1);
        for (const lang of NOTES_CODE_LANGUAGES) {
            expect(options).toContain(lang.label);
        }
    });

    it('defaults a new (language-less) block to Plain text', () => {
        const { props } = makeProps(null);
        render(<CodeBlockLanguageView {...props} />);

        const select = screen.getByLabelText('Code block language') as HTMLSelectElement;
        expect(select.value).toBe('');
    });

    it('reflects an existing block language in the picker', () => {
        const { props } = makeProps('python');
        render(<CodeBlockLanguageView {...props} />);

        const select = screen.getByLabelText('Code block language') as HTMLSelectElement;
        expect(select.value).toBe('python');
    });

    it('sets the node language attribute when a language is chosen', () => {
        const { props, updateAttributes } = makeProps(null);
        render(<CodeBlockLanguageView {...props} />);

        const select = screen.getByLabelText('Code block language') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'python' } });

        expect(updateAttributes).toHaveBeenCalledWith({ language: 'python' });
    });

    it('clears the language attribute when "Plain text" is chosen', () => {
        const { props, updateAttributes } = makeProps('typescript');
        render(<CodeBlockLanguageView {...props} />);

        const select = screen.getByLabelText('Code block language') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '' } });

        expect(updateAttributes).toHaveBeenCalledWith({ language: null });
    });

    it('renders the editable code content inside a <pre>', () => {
        const { props } = makeProps('typescript');
        const { container } = render(<CodeBlockLanguageView {...props} />);

        expect(container.querySelector('pre code')).not.toBeNull();
    });
});

// ── Extension wiring ─────────────────────────────────────────────────────────

describe('NotesCodeBlock extension', () => {
    it('extends CodeBlockLowlight with the language-picker NodeView', () => {
        expect((NotesCodeBlock as any).name).toBe('codeBlock');
        const nodeView = (NotesCodeBlock as any).addNodeView();
        // ReactNodeViewRenderer is mocked to identity, so it returns the component.
        expect(nodeView).toBe(CodeBlockLanguageView);
    });
});
