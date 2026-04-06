/**
 * TasksAiDialogs — AI dialog portals: UpdateDocument only.
 * Run Skill and Bulk Run Skill are now handled by the global EnqueueDialog
 * via QueueContext dispatch (OPEN_DIALOG with contextFiles).
 */

import type { TaskFolder } from '../hooks/useTaskTree';
import { UpdateDocumentDialog } from '../shared/UpdateDocumentDialog';

interface TasksAiDialogsProps {
    wsId: string;
    // File-level AI dialogs
    aiDialogType: 'follow-prompt' | 'update-document' | null;
    aiDialogTarget: { path: string; name: string } | null;
    closeAiDialog: () => void;
    // Folder-level AI dialog (kept for non-follow-prompt actions)
    folderDialogAction: string | null;
    folderDialogFolder: TaskFolder | null;
    closeFolderDialog: () => void;
}

export function TasksAiDialogs({
    wsId,
    aiDialogType,
    aiDialogTarget,
    closeAiDialog,
}: TasksAiDialogsProps) {
    return (
        <>
            {/* File-level Update Document dialog */}
            {aiDialogType === 'update-document' && aiDialogTarget && (
                <UpdateDocumentDialog
                    wsId={wsId}
                    taskPath={aiDialogTarget.path}
                    taskName={aiDialogTarget.name}
                    onClose={closeAiDialog}
                />
            )}
        </>
    );
}
