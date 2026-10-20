import { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { editor as MonacoEditor, Selection } from 'monaco-editor';
import { MonacoSelectionAttachPill } from '../../../shared/monaco/MonacoSelectionAttachPill';
import { monacoToSelection, type DiffEditorSide } from './diffCoords';
import type { DiffEditorAdapter } from './monacoDiffController';
import type { MonacoDiffCommentHandlers, MonacoDiffCommentState } from './MonacoDiffCommentLayer';
import { createMonacoDiffSelectionDragPayload, type DiffSelectionDragSource } from './diffSelectionContext';

interface Props extends Pick<MonacoDiffCommentHandlers, 'onAddComment'> {
    workspaceId: string;
    editor: DiffEditorAdapter | null;
    source?: DiffSelectionDragSource;
    modelsVersion: number;
    diff: MonacoDiffCommentState | null;
}

/** Portals keep selection coordinates local to each side, including split view. */
export function MonacoDiffSelectionAttachPill({ editor, workspaceId, source, modelsVersion, diff, onAddComment }: Props) {
    return (['original', 'modified'] as const).map(side => {
        const codeEditor = editor?.getSelectionEditor?.(side);
        const host = codeEditor?.getDomNode();
        return codeEditor && host ? createPortal(
            <SideSelectionPill editor={codeEditor} side={side} workspaceId={workspaceId} source={source} diff={diff} modelsVersion={modelsVersion} onAddComment={onAddComment} />,
            host,
            side,
        ) : null;
    });
}

function SideSelectionPill({ editor, side, workspaceId, source, diff, modelsVersion, onAddComment }: Omit<Props, 'editor'> & {
    editor: MonacoEditor.ICodeEditor;
    side: DiffEditorSide;
}) {
    const buildPayload = useMemo(() => (selection: Selection, model: MonacoEditor.ITextModel) => {
        if (!diff || !source) return null;
        return createMonacoDiffSelectionDragPayload(
            monacoToSelection(side, selection, diff),
            model.getValueInRange(selection),
            source,
        );
    }, [side, source, diff, modelsVersion]);
    const comment = useCallback((selection: Selection, model: MonacoEditor.ITextModel, position: { top: number; left: number }) => {
        if (diff) onAddComment?.(monacoToSelection(side, selection, diff), model.getValueInRange(selection), position);
    }, [side, diff, onAddComment, modelsVersion]);
    return (
        <div
            className="absolute inset-0 pointer-events-none"
            onMouseDownCapture={event => { event.preventDefault(); event.stopPropagation(); }}
        >
            <MonacoSelectionAttachPill editor={editor} workspaceId={workspaceId} destinationId={source?.destinationId} buildPayload={source ? buildPayload : undefined} onComment={diff && onAddComment ? comment : undefined} />
        </div>
    );
}
