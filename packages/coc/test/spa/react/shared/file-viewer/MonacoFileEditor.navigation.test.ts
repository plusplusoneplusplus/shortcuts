import { describe, expect, it, vi } from 'vitest';
import type { editor as monacoEditor } from 'monaco-editor';
import {
    createEditorNavigationController,
    type EditorNavigationSnapshot,
} from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

function snapshot(line: number, column = 1): EditorNavigationSnapshot {
    return {
        selection: {
            selectionStartLineNumber: line,
            selectionStartColumn: column,
            positionLineNumber: line,
            positionColumn: column,
        },
        viewState: {
            cursorState: [{
                inSelectionMode: false,
                selectionStart: { lineNumber: line, column },
                position: { lineNumber: line, column },
            }],
            viewState: {
                scrollLeft: 0,
                scrollTop: line * 10,
                firstPosition: { lineNumber: line, column: 1 },
                firstPositionDeltaTop: 0,
            },
            contributionsState: {},
        },
    };
}

function fakeEditor(initial = snapshot(4)) {
    let current = initial;
    let cursorListener: ((event: monacoEditor.ICursorSelectionChangedEvent) => void) | null = null;
    let scrollListener: (() => void) | null = null;
    const editor = {
        getSelection: vi.fn(() => current.selection),
        saveViewState: vi.fn(() => current.viewState),
        restoreViewState: vi.fn((viewState: monacoEditor.ICodeEditorViewState) => {
            current = { ...current, viewState };
        }),
        setSelection: vi.fn((selection: monacoEditor.ISelection) => {
            current = { ...current, selection };
        }),
        onDidChangeCursorSelection: vi.fn((listener: (event: monacoEditor.ICursorSelectionChangedEvent) => void) => {
            cursorListener = listener;
            return { dispose: vi.fn() };
        }),
        onDidScrollChange: vi.fn((listener: () => void) => {
            scrollListener = listener;
            return { dispose: vi.fn() };
        }),
    };
    return {
        editor,
        setCurrent: (next: EditorNavigationSnapshot) => { current = next; },
        fireCursor: (source: string) => cursorListener?.({ source } as monacoEditor.ICursorSelectionChangedEvent),
        fireScroll: () => scrollListener?.(),
    };
}

describe('createEditorNavigationController', () => {
    it('captures the full selection and view state', () => {
        const source = snapshot(12, 7);
        const fake = fakeEditor(source);

        expect(createEditorNavigationController(fake.editor).capture()).toEqual(source);
    });

    it.each([
        ['code.navigation', 'navigation'],
        ['code.jump', 'jump'],
        ['api', 'programmatic'],
        ['keyboard', 'user'],
    ] as const)('maps Monaco source %s to %s', (source, reason) => {
        const fake = fakeEditor();
        const listener = vi.fn();
        createEditorNavigationController(fake.editor).subscribe(listener);

        fake.fireCursor(source);

        expect(listener).toHaveBeenCalledWith(snapshot(4), reason);
    });

    it('reports scroll changes with the current exact view state', () => {
        const fake = fakeEditor();
        const listener = vi.fn();
        createEditorNavigationController(fake.editor).subscribe(listener);
        fake.setCurrent(snapshot(4, 8));

        fake.fireScroll();

        expect(listener).toHaveBeenCalledWith(snapshot(4, 8), 'user');
    });

    it('restores view state and selection without reporting emitted replay events', async () => {
        const fake = fakeEditor();
        const listener = vi.fn();
        const controller = createEditorNavigationController(fake.editor);
        controller.subscribe(listener);
        const destination = snapshot(40, 3);

        controller.restore(destination);
        fake.fireCursor('api');
        fake.fireScroll();

        expect(fake.editor.restoreViewState).toHaveBeenCalledWith(destination.viewState);
        expect(fake.editor.setSelection).toHaveBeenCalledWith(destination.selection);
        expect(listener).not.toHaveBeenCalled();

        await Promise.resolve();
        fake.fireCursor('keyboard');
        expect(listener).toHaveBeenCalledWith(destination, 'user');
    });
});
