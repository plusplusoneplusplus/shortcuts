/**
 * ChatFolderArchiveDialog — the confirm shown before archiving every chat in a
 * folder (AC-09).
 *
 * The title names the count, because that is the only thing the user needs to
 * weigh, and the body says what survives: the folder itself, and each chat's
 * place in it. Pinned members are skipped, and the dialog says so when there
 * are any — they cannot be archived while pinned.
 */
import React from 'react';
import { Button, Dialog } from '../../ui';
import { buildArchiveAllTitle, formatChatCount } from './chat-folder-archive';

export interface ChatFolderArchiveDialogProps {
    open: boolean;
    folderName: string;
    /** How many chats will actually be archived. Always at least 1. */
    archiveCount: number;
    /** Pinned members that will be left alone. */
    pinnedSkipped: number;
    onCancel: () => void;
    onConfirm: () => void;
}

export function ChatFolderArchiveDialog({
    open,
    folderName,
    archiveCount,
    pinnedSkipped,
    onCancel,
    onConfirm,
}: ChatFolderArchiveDialogProps): React.ReactElement | null {
    if (!open) {return null;}
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            title={buildArchiveAllTitle(archiveCount)}
            id="chat-folder-archive-dialog"
            className="max-w-[420px]"
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onCancel} data-testid="chat-folder-archive-cancel">
                        Cancel
                    </Button>
                    <Button variant="primary" size="sm" onClick={onConfirm} data-testid="chat-folder-archive-confirm">
                        Archive
                    </Button>
                </div>
            }
        >
            <p
                className="text-[13px] leading-relaxed text-[#1e1e1e] dark:text-[#cccccc]"
                data-testid="chat-folder-archive-copy"
            >
                {formatChatCount(archiveCount)} in “{folderName}” will move to Archived. The folder
                stays, and each chat keeps its place in it — unarchiving puts it right back.
                {pinnedSkipped > 0 && ` ${pinnedSkipped} pinned ${pinnedSkipped === 1 ? 'chat is' : 'chats are'} skipped.`}
            </p>
        </Dialog>
    );
}
