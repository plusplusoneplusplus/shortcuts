// @vitest-environment jsdom
/**
 * MonacoFileEditor — handing the model up to a language host (AC-03).
 *
 * The editor itself registers nothing; it only offers `onModelMount`, and what
 * matters is the lifetime of that offer. A registration made for one model must
 * be taken back down when Monaco swaps the model out and when the editor goes
 * away, because a provider outliving its model would answer questions about a
 * buffer nobody is showing any more.
 *
 * jsdom cannot run Monaco, so `@monaco-editor/react` is stubbed with a fake
 * editor whose model can be replaced on demand.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MonacoFileEditor } from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const stub = vi.hoisted(() => ({
    model: { id: 'model-1' } as { id: string },
    modelListeners: [] as (() => void)[],
    modelListenerDisposals: 0,
    monaco: { editor: { setModelMarkers: vi.fn() }, KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } },
    editor: {
        getModel: () => stub.model,
        onDidChangeModel: (listener: () => void) => {
            stub.modelListeners.push(listener);
            return { dispose: () => { stub.modelListenerDisposals += 1; } };
        },
        createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        addAction: vi.fn(),
    },
}));

vi.mock('@monaco-editor/react', () => ({
    default: ({ onMount }: any) => {
        const mounted = (globalThis as any).__modelMountMounted;
        if (!mounted) {
            (globalThis as any).__modelMountMounted = true;
            queueMicrotask(() => onMount?.(stub.editor, stub.monaco));
        }
        return <div data-testid="fake-monaco" />;
    },
}));

vi.mock('../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

/** Replace the editor's model and fire Monaco's change event. */
function swapModel(id: string) {
    stub.model = { id };
    for (const listener of [...stub.modelListeners]) {
        listener();
    }
}

async function flushMount() {
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__modelMountMounted = false;
    stub.model = { id: 'model-1' };
    stub.modelListeners = [];
    stub.modelListenerDisposals = 0;
});

describe('MonacoFileEditor — onModelMount', () => {
    it('hands the monaco namespace and the model to the host once mounted', async () => {
        const onModelMount = vi.fn();
        render(<MonacoFileEditor value="a" language="typescript" onModelMount={onModelMount} />);
        await flushMount();

        expect(onModelMount).toHaveBeenCalledTimes(1);
        expect(onModelMount.mock.calls[0][0]).toEqual({ monaco: stub.monaco, model: { id: 'model-1' } });
    });

    it('runs the cleanup and re-registers when Monaco replaces the model', async () => {
        const cleanup = vi.fn();
        const onModelMount = vi.fn(() => cleanup);
        render(<MonacoFileEditor value="a" language="typescript" onModelMount={onModelMount} />);
        await flushMount();
        expect(cleanup).not.toHaveBeenCalled();

        await act(async () => { swapModel('model-2'); });

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(onModelMount).toHaveBeenCalledTimes(2);
        expect(onModelMount.mock.calls[1][0].model).toEqual({ id: 'model-2' });
    });

    it('runs the cleanup on unmount and stops listening for model changes', async () => {
        const cleanup = vi.fn();
        const { unmount } = render(
            <MonacoFileEditor value="a" language="typescript" onModelMount={() => cleanup} />,
        );
        await flushMount();

        await act(async () => { unmount(); });

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(stub.modelListenerDisposals).toBe(1);
    });

    it('re-registers when the host swaps the callback, so a new document is picked up', async () => {
        const firstCleanup = vi.fn();
        const first = vi.fn(() => firstCleanup);
        const second = vi.fn();
        const { rerender } = render(
            <MonacoFileEditor value="a" language="typescript" onModelMount={first} />,
        );
        await flushMount();

        await act(async () => {
            rerender(<MonacoFileEditor value="a" language="typescript" onModelMount={second} />);
        });

        expect(firstCleanup).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('never touches the host when no callback is given', async () => {
        render(<MonacoFileEditor value="a" language="typescript" />);
        await flushMount();

        // Nothing to assert on the host side; what matters is that mounting a
        // plain viewer does not throw and leaves no model listener behind for
        // the editor to have to dispose.
        expect(stub.modelListeners).toHaveLength(1);
        expect(stub.modelListenerDisposals).toBe(0);
    });
});
