// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UnifiedSourceMirror } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedSourceMirror';
import { resetActiveChatAttach, subscribeActiveChatAttach } from '../../../../src/server/spa/client/react/features/chat/activeChatAttach';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

vi.mock('@monaco-editor/react', () => ({ default: () => null }));

function sharedModel(readOnly: boolean) {
    let configurationListener: ((event: { hasChanged(option: number): boolean }) => void) | null = null;
    const created: any[] = [];
    const model = { uri: 'file:///a.ts', dispose: vi.fn() };
    const source = {
        getOption: vi.fn(() => readOnly),
        onDidChangeConfiguration: (listener: typeof configurationListener) => {
            configurationListener = listener;
            return { dispose: vi.fn() };
        },
    };
    const monaco = {
        editor: {
            EditorOption: { readOnly: 91 },
            create: vi.fn((_host: HTMLElement, options: any) => {
                const listeners: Record<string, () => void> = {};
                const on = (name: string) => (listener: () => void) => { listeners[name] = listener; return { dispose: vi.fn() }; };
                const editor = {
                    options,
                    listeners,
                    selection: null as null | { startLineNumber: number; endLineNumber: number; endColumn: number },
                    getSelection() {
                        const selected = this.selection;
                        return selected && {
                            ...selected, isEmpty: () => false,
                            getStartPosition: () => ({ lineNumber: selected.startLineNumber, column: 1 }),
                            getEndPosition: () => ({ lineNumber: selected.endLineNumber, column: selected.endColumn }),
                        };
                    },
                    getModel: () => ({ getValueInRange: () => 'mirrored text' }),
                    hasWidgetFocus: () => true,
                    getScrolledVisiblePosition: ({ lineNumber }: { lineNumber: number }) => ({ top: lineNumber * 18, left: 80, height: 18 }),
                    getLayoutInfo: () => ({ width: 500, height: 300, contentLeft: 40, contentWidth: 450 }),
                    onDidChangeCursorSelection: on('selection'),
                    onDidFocusEditorWidget: on('focus'),
                    onDidScrollChange: on('scroll'),
                    onDidLayoutChange: on('layout'),
                    onDidChangeModel: on('model'),
                    onDidBlurEditorWidget: on('blur'),
                    layout: vi.fn(),
                    updateOptions: vi.fn(),
                    dispose: vi.fn(),
                    addAction: vi.fn(() => ({ dispose: vi.fn() })),
                };
                created.push(editor);
                return editor;
            }),
        },
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { KeyS: 49 },
    };
    return {
        context: { editor: source, monaco, model } as any,
        created,
        model,
        setReadOnly(next: boolean) {
            readOnly = next;
            configurationListener?.({ hasChanged: option => option === 91 });
        },
    };
}

afterEach(() => {
    cleanup();
    resetActiveChatAttach();
    _resetRuntimeConfig();
});

describe('UnifiedSourceMirror', () => {
    it('waits for the shared model before creating a second view', () => {
        render(<UnifiedSourceMirror shared={null} />);
        expect(screen.getByTestId('unified-panel-split-mirror').textContent).toContain('shown in the other pane');
    });

    it('attaches to the shared model, follows its read-only state, and leaves the model to its owner', () => {
        const shared = sharedModel(false);
        const { unmount } = render(<UnifiedSourceMirror shared={shared.context} />);
        expect(shared.created).toHaveLength(1);
        const [editor] = shared.created;
        expect(editor.options.model).toBe(shared.model);
        expect(editor.options.readOnly).toBe(false);

        shared.setReadOnly(true);
        expect(editor.updateOptions).toHaveBeenCalledWith({ readOnly: true });

        unmount();
        expect(editor.dispose).toHaveBeenCalled();
        expect(shared.model.dispose).not.toHaveBeenCalled();
    });

    it('saves through the supplied handler', () => {
        const shared = sharedModel(false);
        const onSave = vi.fn(async () => true);
        render(<UnifiedSourceMirror shared={shared.context} onSave={onSave} />);
        const action = shared.created[0].addAction.mock.calls[0][0];
        expect(action.keybindings).toEqual([2048 | 49]);
        action.run();
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('attaches a mirror selection with the identity the file tab published', () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        const handler = vi.fn(() => true);
        subscribeActiveChatAttach('remote:server-b:repo-A', handler);
        const shared = sharedModel(false);
        const context = { ...shared.context, selectionContext: { workspaceId: 'repo-A', filePath: 'src/a.ts', destinationId: 'remote:server-b:repo-A' } };
        render(<UnifiedSourceMirror shared={context} />);
        const [editor] = shared.created;
        act(() => { editor.selection = { startLineNumber: 3, endLineNumber: 5, endColumn: 1 }; editor.listeners.selection(); });
        fireEvent.click(screen.getByRole('button', { name: 'Attach as context' }));
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'coc.file-selection-context', sourceWorkspaceId: 'repo-A', filePath: 'src/a.ts',
            range: { start: 3, end: 4 }, snippet: 'mirrored text',
        }));
    });

    it('offers no attachment when the file tab published no identity (read-only previews)', () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        const shared = sharedModel(true);
        render(<UnifiedSourceMirror shared={shared.context} />);
        expect(shared.created[0].listeners.selection).toBeUndefined();
        expect(screen.queryByRole('group', { name: 'Selection actions' })).toBeNull();
    });
});
