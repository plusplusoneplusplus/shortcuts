import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { editor as MonacoEditor, Selection } from 'monaco-editor';
import { MonacoSelectionAttachPill } from '../../../shared/monaco/MonacoSelectionAttachPill';
import { monacoToSelection, type DiffEditorSide } from './diffCoords';
import type { DiffEditorAdapter } from './monacoDiffController';
import type { MonacoDiffCommentState } from './MonacoDiffCommentLayer';
import { createMonacoDiffSelectionDragPayload, type DiffSelectionDragSource } from './diffSelectionContext';

interface Props {
    editor: DiffEditorAdapter | null;
    source: DiffSelectionDragSource;
    modelsVersion: number;
    diff: MonacoDiffCommentState | null;
}

/** Portals keep selection coordinates local to each side, including split view. */
export function MonacoDiffSelectionAttachPill({ editor, source, modelsVersion, diff }: Props) {
    return (['original', 'modified'] as const).map(side => {
        const codeEditor = editor?.getSelectionEditor?.(side);
        const host = codeEditor?.getDomNode();
        return codeEditor && host ? createPortal(
            <SideSelectionPill editor={codeEditor} side={side} source={source} diff={diff} modelsVersion={modelsVersion} />,
            host,
            side,
        ) : null;
    });
}

function SideSelectionPill({ editor, side, source, diff, modelsVersion }: {
    editor: MonacoEditor.ICodeEditor;
    side: DiffEditorSide;
    source: DiffSelectionDragSource;
    diff: MonacoDiffCommentState | null;
    modelsVersion: number;
}) {
    const buildPayload = useMemo(() => (selection: Selection, model: MonacoEditor.ITextModel) => {
        if (!diff) return null;
        return createMonacoDiffSelectionDragPayload(
            monacoToSelection(side, selection, diff),
            model.getValueInRange(selection),
            source,
        );
    }, [side, source, diff, modelsVersion]);
    return (
        <div
            className="absolute inset-0 pointer-events-none"
            onMouseDownCapture={event => { event.preventDefault(); event.stopPropagation(); }}
        >
            <MonacoSelectionAttachPill editor={editor} workspaceId={source.workspaceId} destinationId={source.destinationId} buildPayload={buildPayload} />
        </div>
    );
}
