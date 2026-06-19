/**
 * TaskPreview — task panel wrapper for NoteEditor using the tasks content API.
 */

import { useCallback, useMemo } from 'react';
import { NoteEditor, type NoteViewMode } from '../features/notes/editor/NoteEditor';
import { noopCommentBackend } from '../features/notes/editor/NoteEditorCommentBackend';
import { createTasksNoteEditorIO } from './TasksNoteEditorIO';
import { useTaskPanel } from '../contexts/TaskContext';
import { Button } from '../ui';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
    taskRootPath?: string | null;
    initialViewMode?: 'review' | 'source' | null;
}

export function TaskPreview({ wsId, filePath, taskRootPath, initialViewMode }: TaskPreviewProps) {
    const { setOpenFilePath } = useTaskPanel();

    // Memoize the IO adapter — stateless, so one instance per mount is fine.
    const tasksIO = useMemo(() => createTasksNoteEditorIO(), []);

    // Map legacy 'review' | 'source' | null → NoteViewMode.
    const mappedInitialViewMode: NoteViewMode = initialViewMode === 'source' ? 'source' : 'rich';

    // Sync view mode changes into the URL hash (?mode=source).
    const handleViewModeChange = useCallback((mode: NoteViewMode) => {
        const hash = location.hash.replace(/^#/, '').split('?')[0];
        const newHash = mode === 'source' ? `#${hash}?mode=source` : `#${hash}`;
        history.replaceState(null, '', newHash);
    }, []);

    return (
        <div id="task-preview-body" className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden" data-testid="task-preview">
            <NoteEditor
                workspaceId={wsId}
                notePath={filePath}
                io={tasksIO}
                commentBackend={noopCommentBackend}
                notesRoot={taskRootPath ?? undefined}
                root={taskRootPath ?? undefined}
                initialViewMode={mappedInitialViewMode}
                onViewModeChange={handleViewModeChange}
                toolbarRight={
                    <Button variant="ghost" size="sm" className="task-preview-close" data-testid="task-preview-close" title="Close preview" onClick={() => setOpenFilePath(null)}>
                        ✕
                    </Button>
                }
            />
        </div>
    );
}
