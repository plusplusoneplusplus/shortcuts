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
    };
}

function fakeEditor(initial = snapshot(4), height = 400) {
    let current = initial;
    let layoutHeight = height;
    let cursorListener: ((event: monacoEditor.ICursorSelectionChangedEvent) => void) | null = null;
    let layoutListener: ((layout: monacoEditor.EditorLayoutInfo) => void) | null = null;
    const editor = {
        getSelection: vi.fn(() => current.selection as monacoEditor.ISelection as never),
        setSelection: vi.fn((selection: monacoEditor.ISelection) => {
            current = { selection };
        }),
        revealRangeInCenterIfOutsideViewport: vi.fn(),
        getLayoutInfo: vi.fn(() => ({ height: layoutHeight }) as monacoEditor.EditorLayoutInfo),
        onDidLayoutChange: vi.fn((listener: (layout: monacoEditor.EditorLayoutInfo) => void) => {
            layoutListener = listener;
            return { dispose: vi.fn(() => { if (layoutListener === listener) layoutListener = null; }) };
        }),
        onDidChangeCursorSelection: vi.fn((listener: (event: monacoEditor.ICursorSelectionChangedEvent) => void) => {
            cursorListener = listener;
            return { dispose: vi.fn() };
        }),
    };
    return {
        editor,
        fireCursor: (source: string) => cursorListener?.({ source } as monacoEditor.ICursorSelectionChangedEvent),
        fireLayout: (nextHeight: number) => {
            layoutHeight = nextHeight;
            layoutListener?.({ height: nextHeight } as monacoEditor.EditorLayoutInfo);
        },
    };
}

describe('createEditorNavigationController', () => {
    it('captures the selection only', () => {
        const fake = fakeEditor(snapshot(12, 7));

        expect(createEditorNavigationController(fake.editor).capture()).toEqual(snapshot(12, 7));
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

    it('does not subscribe to scroll changes', () => {
        const fake = fakeEditor();
        const editor = { ...fake.editor, onDidScrollChange: vi.fn() };
        createEditorNavigationController(editor).subscribe(vi.fn());

        expect(editor.onDidScrollChange).not.toHaveBeenCalled();
    });

    it('restores the selection, centres it if outside the viewport, and suppresses replay events', async () => {
        const fake = fakeEditor();
        const listener = vi.fn();
        const controller = createEditorNavigationController(fake.editor);
        controller.subscribe(listener);
        const destination = snapshot(40, 3);

        controller.restore(destination);
        fake.fireCursor('api');

        expect(fake.editor.setSelection).toHaveBeenCalledWith(destination.selection);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalledWith(destination.selection);
        expect(listener).not.toHaveBeenCalled();

        await Promise.resolve();
        fake.fireCursor('keyboard');
        expect(listener).toHaveBeenCalledWith(destination, 'user');
    });

    it('waits for a real layout before revealing in an editor that was hidden', () => {
        const fake = fakeEditor(snapshot(4), 0);
        const controller = createEditorNavigationController(fake.editor);

        controller.restore(snapshot(90));
        expect(fake.editor.setSelection).toHaveBeenCalledWith(snapshot(90).selection);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).not.toHaveBeenCalled();

        fake.fireLayout(0);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).not.toHaveBeenCalled();

        fake.fireLayout(500);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalledTimes(1);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalledWith(snapshot(90).selection);

        fake.fireLayout(600);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalledTimes(1);
    });

    it('drops a pending hidden-editor reveal when a newer restore arrives', () => {
        const fake = fakeEditor(snapshot(4), 0);
        const controller = createEditorNavigationController(fake.editor);

        controller.restore(snapshot(90));
        controller.restore(snapshot(120));
        fake.fireLayout(500);

        expect(fake.editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalledTimes(1);
        expect(fake.editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalledWith(snapshot(120).selection);
    });
});
