/**
 * TasksAiDialogs — AI dialog portals: FollowPrompt, UpdateDocument, BulkFollowPrompt.
 */

import type { TaskFolder } from '../hooks/useTaskTree';
import { FollowPromptDialog } from '../shared/FollowPromptDialog';
import { UpdateDocumentDialog } from '../shared/UpdateDocumentDialog';
import { BulkFollowPromptDialog } from '../shared/BulkFollowPromptDialog';

interface TasksAiDialogsProps {
    wsId: string;
    // File-level AI dialogs
    aiDialogType: 'follow-prompt' | 'update-document' | null;
    aiDialogTarget: { path: string; name: string } | null;
    closeAiDialog: () => void;
    // Folder-level AI dialog (Bulk Run Skill)
    folderDialogAction: string | null;
    folderDialogFolder: TaskFolder | null;
    closeFolderDialog: () => void;
}

export function TasksAiDialogs({
    wsId,
    aiDialogType,
    aiDialogTarget,
    closeAiDialog,
    folderDialogAction,
    folderDialogFolder,
    closeFolderDialog,
}: TasksAiDialogsProps) {
    return (
        <>
            {/* File-level AI dialogs */}
            {aiDialogType === 'follow-prompt' && aiDialogTarget && (
                <FollowPromptDialog
                    wsId={wsId}
                    taskPath={aiDialogTarget.path}
                    taskName={aiDialogTarget.name}
                    onClose={closeAiDialog}
                />
            )}
            {aiDialogType === 'update-document' && aiDialogTarget && (
                <UpdateDocumentDialog
                    wsId={wsId}
                    taskPath={aiDialogTarget.path}
                    taskName={aiDialogTarget.name}
                    onClose={closeAiDialog}
                />
            )}

            {/* Bulk Run Skill dialog */}
            {folderDialogAction === 'follow-prompt' && folderDialogFolder && (
                <BulkFollowPromptDialog
                    wsId={wsId}
                    folder={folderDialogFolder}
                    onClose={closeFolderDialog}
                />
            )}
        </>
    );
}
