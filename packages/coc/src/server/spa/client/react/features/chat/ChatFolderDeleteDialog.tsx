/**
 * ChatFolderDeleteDialog — the confirm shown before deleting a folder that
 * still has chats in it (AC-05).
 *
 * The one thing this dialog exists to say is that nothing is destroyed: a
 * folder is a label, so deleting it unfiles its chats and leaves every
 * conversation intact. Deliberately the app's own Dialog, never
 * `window.confirm` — a native prompt cannot carry that sentence, and an empty
 * folder gets no dialog at all.
 */
import React from 'react';
import { Button, Dialog } from '../../ui';

export interface ChatFolderDeleteDialogProps {
    open: boolean;
    folderName: string;
    /** How many chats are currently filed in the folder. Always at least 1. */
    memberCount: number;
    onCancel: () => void;
    onConfirm: () => void;
}

export function ChatFolderDeleteDialog({
    open,
    folderName,
    memberCount,
    onCancel,
    onConfirm,
}: ChatFolderDeleteDialogProps): React.ReactElement | null {
    if (!open) {return null;}
    const chats = memberCount === 1 ? '1 chat' : `${memberCount} chats`;
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            title={`Delete "${folderName}"?`}
            id="chat-folder-delete-dialog"
            className="max-w-[420px]"
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onCancel} data-testid="chat-folder-delete-cancel">
                        Cancel
                    </Button>
                    <Button variant="danger" size="sm" onClick={onConfirm} data-testid="chat-folder-delete-confirm">
                        Delete folder
                    </Button>
                </div>
            }
        >
            <p
                className="text-[13px] leading-relaxed text-[#1e1e1e] dark:text-[#cccccc]"
                data-testid="chat-folder-delete-copy"
            >
                No conversations will be deleted. {chats} will become unfiled and go back to the
                normal date list.
            </p>
        </Dialog>
    );
}
