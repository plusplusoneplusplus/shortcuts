/**
 * SourceCanvasNoteEditor — editable markdown body for the docked source canvas
 * (AC-02). When a chat-message markdown link opens the canvas (`kind: 'note'`),
 * this renders the full editable `NoteEditor` (inline edit + auto-save) in the
 * single canvas slot, in place of the read-only Rendered/Raw source viewer.
 *
 * Editor wiring matches the floating `MarkdownReviewDialog` exactly: the
 * comment backend is `noopCommentBackend` (inert comments) and the IO adapter is
 * chosen by `fetchMode` (`tasks` for files under `.vscode/tasks/`, otherwise the
 * workspace-file adapter). Path/workspace/`taskRootPath` resolution is shared
 * with the dialog via `resolveMarkdownReviewTarget`, so the two surfaces stay in
 * sync.
 */
import { useMemo } from 'react';
import { useApp } from '../../../contexts/AppContext';
import { NoteEditor } from '../../notes/editor/NoteEditor';
import { noopCommentBackend } from '../../notes/editor/NoteEditorCommentBackend';
import { createTasksNoteEditorIO } from '../../../tasks/TasksNoteEditorIO';
import { createWorkspaceFileNoteEditorIO } from '../../../tasks/WorkspaceFileNoteEditorIO';
import {
    resolveMarkdownReviewTarget,
    type WorkspaceLike,
} from '../../../shared/markdown-review/resolveMarkdownReviewTarget';
import type { SourceCanvasFileRef } from './types';

export interface SourceCanvasNoteEditorProps {
    fileRef: SourceCanvasFileRef;
}

export function SourceCanvasNoteEditor({ fileRef }: SourceCanvasNoteEditorProps) {
    const { state } = useApp();
    const workspaces = state.workspaces as WorkspaceLike[] | undefined;

    // Stateless adapters — create once per mount.
    const tasksIO = useMemo(() => createTasksNoteEditorIO(), []);
    const workspaceIO = useMemo(() => createWorkspaceFileNoteEditorIO(), []);

    const target = useMemo(
        () => resolveMarkdownReviewTarget(
            {
                filePath: fileRef.fullPath,
                wsId: fileRef.wsId,
                sourceFilePath: fileRef.sourceFilePath,
            },
            workspaces || [],
        ),
        [fileRef.fullPath, fileRef.wsId, fileRef.sourceFilePath, workspaces],
    );

    if (!target) {
        return (
            <div className="p-4 text-xs" data-testid="source-canvas-note-error">
                <div className="font-medium text-[#cc4444] dark:text-[#f48771]">
                    {`Couldn't open ${fileRef.displayPath || fileRef.fullPath}`}
                </div>
                <div className="mt-1 text-[#848484]">No matching workspace found.</div>
            </div>
        );
    }

    const editorIO = target.fetchMode === 'tasks' ? tasksIO : workspaceIO;

    return (
        <div
            className="flex-1 min-h-0 overflow-hidden flex flex-col"
            data-testid="source-canvas-note-editor"
            data-ws-id={target.wsId}
        >
            <NoteEditor
                workspaceId={target.wsId}
                notePath={target.filePath}
                io={editorIO}
                commentBackend={noopCommentBackend}
                notesRoot={target.taskRootPath ?? undefined}
            />
        </div>
    );
}
