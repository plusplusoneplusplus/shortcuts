/**
 * UnifiedNoteTab — the body of a `note` tab in the unified right panel (AC-04).
 *
 * The editor and its wiring are the ones the docked source canvas already uses
 * for a note link (`SourceCanvasNoteEditor`): the full editable `NoteEditor`
 * with inert comments (`noopCommentBackend`) and the IO adapter picked by the
 * note's fetch mode — tasks-backed under a `.vscode/tasks/` root, workspace-file
 * otherwise. Nothing here is a second note transport or a second editor.
 *
 * The difference is where the wiring comes from. The docked canvas re-resolves
 * the clicked link on every open; a tab is persisted, so by the time it is
 * restored the link, the message it appeared in, and the workspace list that
 * resolved it may all be gone. `unifiedNoteTabs` therefore stores the resolved
 * answer in the descriptor's `resourceId`, and this component only decodes it.
 *
 * A descriptor that cannot be decoded shows an explicit state with a close
 * action and reports itself as an error, so a bad entry is visible in the strip
 * rather than rendering an empty panel.
 */

import { useEffect, useMemo } from 'react';
import { NoteEditor } from '../../notes/editor/NoteEditor';
import { noopCommentBackend } from '../../notes/editor/NoteEditorCommentBackend';
import { createTasksNoteEditorIO } from '../../../tasks/TasksNoteEditorIO';
import { createWorkspaceFileNoteEditorIO } from '../../../tasks/WorkspaceFileNoteEditorIO';
import { parseNoteResourceId } from './unifiedNoteTabs';

export interface UnifiedNoteTabProps {
    /** The clone that owns the note — where loads and saves route. */
    workspaceId: string;
    /** The tab's `resourceId`: `<fetchMode>|<root>|<path>`. */
    resourceId: string;
    /** The tab label, echoed in the undecodable state. */
    label: string;
    /** Best-effort line to scroll near when the note opens. */
    line?: number;
    /** Close this tab (the panel's own X routes here). */
    onClose: () => void;
    /** Report an undecodable descriptor to the strip. */
    onErrorChange?: (hasError: boolean) => void;
    /** Report unsaved edits to the strip (AC-05's close guard reads this). */
    onDirtyChange?: (dirty: boolean) => void;
    /** Publish the editor's save entry point so a close can write first. */
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
}

export function UnifiedNoteTab({
    workspaceId, resourceId, label, line, onClose, onErrorChange, onDirtyChange, onRegisterSave,
}: UnifiedNoteTabProps) {
    const resource = useMemo(() => parseNoteResourceId(resourceId), [resourceId]);

    // Stateless adapters — create once per mount, as the docked editor does.
    const tasksIO = useMemo(() => createTasksNoteEditorIO(), []);
    const workspaceIO = useMemo(() => createWorkspaceFileNoteEditorIO(), []);

    const invalid = resource === null;
    useEffect(() => {
        onErrorChange?.(invalid);
        return () => onErrorChange?.(false);
    }, [invalid, onErrorChange]);

    if (resource === null) {
        return (
            <div
                className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]"
                data-testid="unified-panel-note-invalid"
            >
                <span>This note tab cannot be opened.</span>
                <span className="opacity-70">{label}</span>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-1 rounded border border-[#e0e0e0] px-2 py-1 hover:bg-black/[0.06] dark:border-[#474749] dark:hover:bg-white/[0.08]"
                    data-testid="unified-panel-note-invalid-close"
                >
                    Close tab
                </button>
            </div>
        );
    }

    return (
        <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            data-testid="unified-panel-note"
            data-ws-id={workspaceId}
        >
            <NoteEditor
                workspaceId={workspaceId}
                notePath={resource.notePath}
                io={resource.fetchMode === 'tasks' ? tasksIO : workspaceIO}
                commentBackend={noopCommentBackend}
                notesRoot={resource.notesRoot}
                scrollToLine={line}
                onDirtyChange={onDirtyChange}
                onRegisterSave={onRegisterSave}
            />
        </div>
    );
}
