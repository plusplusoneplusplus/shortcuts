// @vitest-environment jsdom
/**
 * MonacoFileEditor — publishing language-server diagnostics as model markers
 * (AC-02/AC-03).
 *
 * Monaco cannot run under jsdom, so `@monaco-editor/react` is stubbed with a
 * fake editor and a fake `monaco` namespace. What is worth pinning here is not
 * the conversion (that is `monacoBridge`'s job) but the *ownership rule*: an
 * editor whose host passes no markers must never touch the model's markers,
 * because a plain viewer sharing a model with a language-enabled one would
 * otherwise wipe its squiggles.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
    MonacoFileEditor,
    LANGUAGE_MARKER_OWNER,
} from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const stub = vi.hoisted(() => ({
    model: { id: 'model-1' },
    setModelMarkers: vi.fn(),
    editor: {
        getModel: vi.fn(),
        createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        addAction: vi.fn(),
    },
}));

vi.mock('@monaco-editor/react', () => ({
    default: ({ onMount }: any) => {
        const mounted = (globalThis as any).__markersMounted;
        if (!mounted) {
            (globalThis as any).__markersMounted = true;
            queueMicrotask(() => onMount?.(stub.editor, {
                editor: { setModelMarkers: stub.setModelMarkers },
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

const marker = (message: string) => ({
    severity: 8,
    message,
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 2,
});

async function flushMount() {
    await act(async () => { await Promise.resolve(); });
}

/** Markers passed to the most recent `setModelMarkers` call. */
function latestMarkers(): any[] {
    const calls = stub.setModelMarkers.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1][2] : [];
}

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__markersMounted = false;
    stub.editor.getModel.mockReturnValue(stub.model);
});

describe('MonacoFileEditor — markers', () => {
    it('publishes the host markers against the model under the shared owner', async () => {
        render(<MonacoFileEditor value="a" language="typescript" markers={[marker('boom')]} />);
        await flushMount();

        expect(stub.setModelMarkers).toHaveBeenCalledWith(
            stub.model,
            LANGUAGE_MARKER_OWNER,
            [marker('boom')],
        );
    });

    it('republishes when the diagnostics change and clears them with an empty set', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="a" language="typescript" markers={[marker('boom')]} />,
        );
        await flushMount();

        rerender(<MonacoFileEditor value="a" language="typescript" markers={[marker('worse')]} />);
        expect(latestMarkers()).toEqual([marker('worse')]);

        rerender(<MonacoFileEditor value="a" language="typescript" markers={[]} />);
        expect(latestMarkers()).toEqual([]);
    });

    it('leaves the model alone when the host manages no markers', async () => {
        const { unmount } = render(<MonacoFileEditor value="a" language="typescript" />);
        await flushMount();

        expect(stub.setModelMarkers).not.toHaveBeenCalled();

        // And still leaves it alone on the way out — a viewer that never
        // published must not clear a sibling view's diagnostics.
        unmount();
        expect(stub.setModelMarkers).not.toHaveBeenCalled();
    });

    it('clears its own markers on unmount', async () => {
        const { unmount } = render(
            <MonacoFileEditor value="a" language="typescript" markers={[marker('boom')]} />,
        );
        await flushMount();
        stub.setModelMarkers.mockClear();

        unmount();
        expect(stub.setModelMarkers).toHaveBeenCalledWith(stub.model, LANGUAGE_MARKER_OWNER, []);
    });
});
