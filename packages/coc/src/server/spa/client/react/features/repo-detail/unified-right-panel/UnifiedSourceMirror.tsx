/**
 * UnifiedSourceMirror — the second view of a file shown in both split panes.
 *
 * It is a plain Monaco editor attached to the SAME text model as the file
 * tab's `PreviewPane`, so the two panes share text, undo, dirty state and the
 * language document while keeping their own selection and scroll. Edits made
 * here reach the pane's buffer through the model's change events; saving goes
 * through the tab's registered save handler, so there is never a second
 * buffer or write path for one file. Selections attach as chat context with
 * the identity the file tab's editor published alongside the model.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor as monacoEditor, Selection } from 'monaco-editor';
import { createEditorFileSelectionPayload, EXPLORER_EDITOR_OPTIONS, type EditorModelMountContext } from '../../../shared/file-viewer/MonacoFileEditor';
import { MonacoSelectionAttachPill } from '../../../shared/monaco/MonacoSelectionAttachPill';

export interface UnifiedSourceMirrorProps {
    /** The model published by the file tab's editor, or null until it exists. */
    shared: EditorModelMountContext | null;
    /** The tab's registered save, when its buffer is writable. */
    onSave?: () => Promise<boolean> | void;
}

export function UnifiedSourceMirror({ shared, onSave }: UnifiedSourceMirrorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const saveRef = useRef(onSave);
    saveRef.current = onSave;
    const [mirror, setMirror] = useState<monacoEditor.ICodeEditor | null>(null);
    const selectionContext = shared?.selectionContext;
    const buildPayload = useCallback((selection: Selection, model: monacoEditor.ITextModel) => (
        selectionContext ? createEditorFileSelectionPayload(selectionContext, selection, model) : null
    ), [selectionContext]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !shared) return;
        const { monaco, model, editor: source } = shared;
        const readOnlyOption = monaco.editor.EditorOption.readOnly;
        const editor = monaco.editor.create(host, {
            ...EXPLORER_EDITOR_OPTIONS,
            model,
            readOnly: source.getOption(readOnlyOption),
        });
        // A deletion lock or a read-only resource on the source applies here too.
        const options = source.onDidChangeConfiguration(event => {
            if (event.hasChanged(readOnlyOption)) editor.updateOptions({ readOnly: source.getOption(readOnlyOption) });
        });
        const save = editor.addAction({
            id: 'file-save',
            label: 'Save File',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run: () => { void saveRef.current?.(); },
        });
        // `automaticLayout` stays off, as for every Explorer editor.
        const layout = () => {
            const { width, height } = host.getBoundingClientRect();
            editor.layout({ width: Math.round(width), height: Math.round(height) });
        };
        layout();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(layout);
        observer?.observe(host);
        setMirror(editor);
        return () => {
            setMirror(null);
            observer?.disconnect();
            options.dispose();
            save.dispose();
            // Disposing the editor leaves the supplied model to its owner.
            editor.dispose();
        };
    }, [shared]);

    return (
        <div className="relative h-full w-full overflow-hidden" data-testid="unified-panel-split-mirror">
            <div ref={hostRef} className="h-full w-full" />
            {selectionContext && (
                <MonacoSelectionAttachPill
                    editor={mirror}
                    workspaceId={selectionContext.workspaceId}
                    destinationId={selectionContext.destinationId}
                    buildPayload={buildPayload}
                    keepInView
                />
            )}
            {!shared && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]">
                    This file is shown in the other pane.
                </div>
            )}
        </div>
    );
}
