// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonacoFileEditor } from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const stub = vi.hoisted(() => ({
    mounted: false,
    actions: [] as Array<{ id: string; run: () => void }>,
    dispose: vi.fn(),
    monaco: {
        editor: { setModelMarkers: vi.fn() },
        KeyMod: { CtrlCmd: 1 },
        KeyCode: { KeyS: 2 },
    },
    editor: {
        getModel: vi.fn(() => ({ id: 'model-1' })),
        onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
        createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        addAction: vi.fn((action: { id: string; run: () => void }) => {
            stub.actions.push(action);
            return { dispose: stub.dispose };
        }),
        layout: vi.fn(),
    },
}));

vi.mock('@monaco-editor/react', () => ({
    default: ({ onMount }: any) => {
        if (!stub.mounted) {
            stub.mounted = true;
            queueMicrotask(() => onMount?.(stub.editor, stub.monaco));
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
    stub.mounted = false;
    stub.actions = [];
});

describe('MonacoFileEditor — save action', () => {
    it('calls the latest save handler after the editor has mounted', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(
            <MonacoFileEditor value="original" language="typescript" onSave={first} />,
        );
        await flushMount();
        const saveAction = stub.actions.find(action => action.id === 'file-save');

        rerender(<MonacoFileEditor value="edited" language="typescript" onSave={second} />);
        saveAction?.run();

        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });

    it('disposes the save action on unmount', async () => {
        const { unmount } = render(
            <MonacoFileEditor value="original" language="typescript" onSave={vi.fn()} />,
        );
        await flushMount();

        unmount();

        expect(stub.dispose).toHaveBeenCalledTimes(1);
    });

    it('keeps one registration while the save handler changes', async () => {
        const { rerender } = render(
            <MonacoFileEditor value="first" language="typescript" onSave={vi.fn()} />,
        );
        await flushMount();

        rerender(<MonacoFileEditor value="second" language="typescript" onSave={vi.fn()} />);
        rerender(<MonacoFileEditor value="third" language="typescript" onSave={vi.fn()} />);

        expect(stub.editor.addAction).toHaveBeenCalledTimes(1);
    });
});
