// @vitest-environment jsdom
/**
 * MonacoFileEditor — a host echoing `onChange` back as `value`.
 *
 * The regression: `value` went straight to `@monaco-editor/react`, which writes
 * any `value` that differs from the model back into it, silently. A host
 * re-renders a keystroke later, so under load a render could carry an older
 * echo after a newer keystroke was already in the model. Writing that echo back
 * rewound the buffer and the cursor, the next keystroke landed in the wrong
 * place, and the language server — never told of the silent rewrite — held
 * different text from the one on screen.
 *
 * Monaco cannot run under jsdom, so `@monaco-editor/react` is stubbed with a
 * one-model fake that reports typing through `onChange` the way the wrapper
 * does.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MonacoFileEditor } from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const stub = vi.hoisted(() => {
    const state = {
        text: '',
        mounted: false,
        onChange: undefined as undefined | ((value: string, event: { changes: unknown[] }) => void),
    };
    const model = {
        getValue: () => state.text,
        getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: state.text.length + 1 }),
    };
    const editor = {
        getModel: () => model,
        getOption: vi.fn(() => false),
        // Like Monaco, a programmatic edit fires the content listener too.
        executeEdits: vi.fn((_source: string, edits: { text: string }[]) => {
            state.text = edits[0].text;
            state.onChange?.(state.text, { changes: [] });
            return true;
        }),
        setValue: vi.fn(),
        pushUndoStop: vi.fn(),
        onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
        createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        addAction: vi.fn(() => ({ dispose: vi.fn() })),
        layout: vi.fn(),
    };
    const monaco = {
        editor: { setModelMarkers: vi.fn(), EditorOption: { readOnly: 0 } },
        KeyMod: { CtrlCmd: 1 },
        KeyCode: { KeyS: 2 },
    };
    /** A keystroke: the model changes first, then the wrapper reports it. */
    const type = (text: string) => {
        state.text = text;
        state.onChange?.(text, { changes: [{ text }] });
    };
    return { state, editor, monaco, type };
});

vi.mock('@monaco-editor/react', () => ({
    default: ({ value, defaultValue, onChange, onMount }: any) => {
        stub.state.onChange = onChange;
        if (!stub.state.mounted) {
            stub.state.mounted = true;
            stub.state.text = value ?? defaultValue ?? '';
            queueMicrotask(() => onMount?.(stub.editor, stub.monaco));
        } else if (value !== undefined && value !== stub.state.text) {
            // What the real wrapper does with a `value` prop: overwrite, unreported.
            stub.state.text = value;
        }
        return <div data-testid="fake-monaco" />;
    },
}));

vi.mock('../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

async function flushMount() {
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    stub.state.text = '';
    stub.state.mounted = false;
    stub.state.onChange = undefined;
});

describe('MonacoFileEditor — host echoes', () => {
    it('does not write a stale echo back over a newer keystroke', async () => {
        const onChange = vi.fn();
        const view = (value: string) => <MonacoFileEditor value={value} language="typescript" onChange={onChange} />;
        const { rerender } = render(view('ab'));
        await flushMount();

        stub.type('abc');
        stub.type('abcd');
        // The host's render for the first keystroke lands after the second.
        await act(async () => { rerender(view('abc')); });
        // The next keystroke would go wherever this leaves the model.
        expect(stub.state.text).toBe('abcd');
        await act(async () => { rerender(view('abcd')); });

        expect(stub.state.text).toBe('abcd');
        expect(stub.editor.executeEdits).not.toHaveBeenCalled();
        expect(onChange.mock.calls.map(call => call[0])).toEqual(['abc', 'abcd']);
    });

    it('applies text the editor never produced, without reporting it as an edit', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<MonacoFileEditor value="" language="typescript" onChange={onChange} />);
        await flushMount();

        await act(async () => {
            rerender(<MonacoFileEditor value="loaded from disk" language="typescript" onChange={onChange} />);
        });

        expect(stub.state.text).toBe('loaded from disk');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('applies a discard back to text the editor showed earlier', async () => {
        const onChange = vi.fn();
        const view = (value: string) => <MonacoFileEditor value={value} language="typescript" onChange={onChange} />;
        const { rerender } = render(view('saved'));
        await flushMount();

        stub.type('saved!');
        await act(async () => { rerender(view('saved!')); });
        await act(async () => { rerender(view('saved')); });

        expect(stub.state.text).toBe('saved');
    });

    it('keeps the cursor where the user typed instead of re-revealing on each echo', async () => {
        const onChange = vi.fn();
        const view = (value: string) => (
            <MonacoFileEditor value={value} language="typescript" onChange={onChange} revealLine={2} revealNonce={1} />
        );
        const { rerender } = render(view('a\nb'));
        await flushMount();
        const reveals = stub.editor.setPosition.mock.calls.length;

        stub.type('a\nbc');
        await act(async () => { rerender(view('a\nbc')); });

        expect(stub.editor.setPosition).toHaveBeenCalledTimes(reveals);
    });
});
