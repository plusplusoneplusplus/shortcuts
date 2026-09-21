// @vitest-environment jsdom
/**
 * MonacoFileEditor — re-revealing a position the editor is already pointed at.
 *
 * The regression: the reveal effect keyed only on `revealLine` / `revealColumn`
 * / `value`, so jumping to a symbol, scrolling away, and jumping to the *same*
 * symbol again changed no prop and the editor never moved. `revealNonce` is the
 * host's "do it again" signal, and it has to be in the effect's deps.
 *
 * Monaco cannot run under jsdom, so `@monaco-editor/react` is stubbed with a
 * fake editor whose reveal calls are what these cases read.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MonacoFileEditor } from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const stub = vi.hoisted(() => ({
    mounted: false,
    editor: {
        getModel: vi.fn(() => ({ id: 'model-1' })),
        createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        addAction: vi.fn(() => ({ dispose: vi.fn() })),
        layout: vi.fn(),
    },
}));

vi.mock('@monaco-editor/react', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: ({ onMount }: any) => {
        if (!stub.mounted) {
            stub.mounted = true;
            queueMicrotask(() => onMount?.(stub.editor, {
                editor: { setModelMarkers: vi.fn() },
                KeyMod: { CtrlCmd: 1 },
                KeyCode: { KeyS: 2 },
            }));
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

/** Every line handed to `revealLineInCenter`, in order. */
function revealedLines(): number[] {
    return stub.editor.revealLineInCenter.mock.calls.map(call => call[0] as number);
}

beforeEach(() => {
    vi.clearAllMocks();
    stub.mounted = false;
});

describe('MonacoFileEditor — repeat reveal', () => {
    it('reveals the same line again when only the nonce changes', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="a\nb\nc" language="typescript" revealLine={42} revealColumn={8} revealNonce={1} />,
        );
        await flushMount();
        expect(revealedLines()).toEqual([42]);

        // The user scrolled away; the same symbol is picked again.
        await act(async () => {
            rerender(
                <MonacoFileEditor value="a\nb\nc" language="typescript" revealLine={42} revealColumn={8} revealNonce={2} />,
            );
        });

        expect(revealedLines()).toEqual([42, 42]);
        expect(stub.editor.setPosition).toHaveBeenLastCalledWith({ lineNumber: 42, column: 8 });
    });

    it('does not re-reveal when nothing about the navigation changed', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="a\nb\nc" language="typescript" revealLine={42} revealNonce={1} />,
        );
        await flushMount();
        const before = revealedLines().length;

        await act(async () => {
            rerender(
                <MonacoFileEditor value="a\nb\nc" language="typescript" revealLine={42} revealNonce={1} />,
            );
        });

        expect(revealedLines()).toHaveLength(before);
    });
});
