/**
 * MonacoFileEditor — whole-line highlight range and optional onChange.
 *
 * Monaco itself cannot run under jsdom, so `@monaco-editor/react` is mocked with
 * a stub that hands a fake editor to `onMount`. That lets us assert the
 * decorations the wrapper installs, and that a *changed* range re-applies on an
 * already-mounted editor (no remount, as when a second `file:line` reference
 * into the same open file arrives).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MonacoFileEditor, EDITOR_HIGHLIGHT_CLASS } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor';

const editorStub = vi.hoisted(() => ({
    collection: { set: vi.fn(), clear: vi.fn() },
    createDecorationsCollection: vi.fn(),
    revealLineInCenter: vi.fn(),
    setPosition: vi.fn(),
    setSelection: vi.fn(),
    addAction: vi.fn(),
    lastOnChange: undefined as ((v: string | undefined) => void) | undefined,
}));

vi.mock('@monaco-editor/react', () => ({
    default: ({ onMount, onChange }: any) => {
        editorStub.lastOnChange = onChange;
        // Mount once, like the real editor does when it finishes loading.
        const mounted = (globalThis as any).__monacoMounted;
        if (!mounted) {
            (globalThis as any).__monacoMounted = true;
            queueMicrotask(() => onMount?.(editorStub, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }));
        }
        return <div data-testid="fake-monaco" />;
    },
}));

vi.mock('../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

/** Decorations passed to the most recent `set`/`createDecorationsCollection` call. */
function latestDecorations(): any[] {
    const setCalls = editorStub.collection.set.mock.calls;
    if (setCalls.length > 0) return setCalls[setCalls.length - 1][0];
    const createCalls = editorStub.createDecorationsCollection.mock.calls;
    return createCalls.length > 0 ? createCalls[createCalls.length - 1][0] : [];
}

async function flushMount() {
    await act(async () => { await Promise.resolve(); });
}

describe('MonacoFileEditor — highlightRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as any).__monacoMounted = false;
        editorStub.createDecorationsCollection.mockReturnValue(editorStub.collection);
    });

    it('installs a whole-line decoration for the range on mount and centres its first line', async () => {
        render(<MonacoFileEditor value="a\nb\nc" language="typescript" readOnly highlightRange={{ start: 2, end: 3 }} />);
        await flushMount();

        expect(editorStub.createDecorationsCollection).toHaveBeenCalledTimes(1);
        expect(latestDecorations()).toEqual([{
            range: { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 },
            options: { isWholeLine: true, className: EDITOR_HIGHLIGHT_CLASS },
        }]);
        expect(editorStub.revealLineInCenter).toHaveBeenCalledWith(2);
    });

    it('re-applies a changed range on the already-mounted editor without a remount', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="x" language="typescript" readOnly highlightRange={{ start: 71, end: 78 }} />,
        );
        await flushMount();
        editorStub.revealLineInCenter.mockClear();

        await act(async () => {
            rerender(<MonacoFileEditor value="x" language="typescript" readOnly highlightRange={{ start: 120, end: 120 }} />);
        });

        // Same collection reused — the editor was never re-created.
        expect(editorStub.createDecorationsCollection).toHaveBeenCalledTimes(1);
        expect(latestDecorations()[0].range).toEqual({
            startLineNumber: 120, startColumn: 1, endLineNumber: 120, endColumn: 1,
        });
        expect(editorStub.revealLineInCenter).toHaveBeenCalledWith(120);
    });

    it('does not re-apply when an equal range object is passed on every render', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="x" language="typescript" readOnly highlightRange={{ start: 5, end: 5 }} />,
        );
        await flushMount();
        editorStub.collection.set.mockClear();

        await act(async () => {
            rerender(<MonacoFileEditor value="x" language="typescript" readOnly highlightRange={{ start: 5, end: 5 }} />);
        });

        expect(editorStub.collection.set).not.toHaveBeenCalled();
    });

    it('clears the decorations when the range goes away', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="x" language="typescript" readOnly highlightRange={{ start: 4, end: 4 }} />,
        );
        await flushMount();

        await act(async () => {
            rerender(<MonacoFileEditor value="x" language="typescript" readOnly highlightRange={null} />);
        });

        expect(latestDecorations()).toEqual([]);
    });

    it('installs no decorations and centres nothing when mounted without a range', async () => {
        render(<MonacoFileEditor value="x" language="typescript" readOnly />);
        await flushMount();

        expect(latestDecorations()).toEqual([]);
        expect(editorStub.revealLineInCenter).not.toHaveBeenCalled();
    });
});

describe('MonacoFileEditor — optional onChange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as any).__monacoMounted = false;
        editorStub.createDecorationsCollection.mockReturnValue(editorStub.collection);
    });

    it('tolerates an edit event with no onChange handler (read-only viewers pass none)', async () => {
        render(<MonacoFileEditor value="x" language="typescript" readOnly />);
        await flushMount();

        expect(() => editorStub.lastOnChange?.('edited')).not.toThrow();
    });

    it('still forwards edits when an onChange handler is supplied', async () => {
        const onChange = vi.fn();
        render(<MonacoFileEditor value="x" language="typescript" onChange={onChange} />);
        await flushMount();

        editorStub.lastOnChange?.('edited');
        expect(onChange).toHaveBeenCalledWith('edited');
    });

    it('registers no save action when read-only', async () => {
        render(<MonacoFileEditor value="x" language="typescript" readOnly onSave={vi.fn()} />);
        await flushMount();

        expect(editorStub.addAction).not.toHaveBeenCalled();
    });
});
