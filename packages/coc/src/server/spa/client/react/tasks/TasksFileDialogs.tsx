/**
 * TasksFileDialogs — rename, delete, and move file dialog portals.
 */

import type { FileCtxInfo } from '../hooks/useFileDialogHandlers';
import type { TaskFolder } from '../hooks/useTaskTree';
import { FolderActionDialog } from './FolderActionDialog';
import { FileMoveDialog } from './FileMoveDialog';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';

interface TasksFileDialogsProps {
    tree: TaskFolder | null;
    fileDialog: { action: 'rename' | 'delete' | null; ctxItem: FileCtxInfo | null; submitting: boolean };
    closeFileDialog: () => void;
    handleFileRename: (newName: string) => Promise<void>;
    handleFileDelete: () => Promise<void>;
    fileMoveDialogOpen: boolean;
    fileMoveCtxItem: FileCtxInfo | null;
    onCloseMoveDialog: () => void;
    handleFileMoveConfirm: (dest: string) => Promise<void>;
}

export function TasksFileDialogs({
    tree,
    fileDialog,
    closeFileDialog,
    handleFileRename,
    handleFileDelete,
    fileMoveDialogOpen,
    fileMoveCtxItem,
    onCloseMoveDialog,
    handleFileMoveConfirm,
}: TasksFileDialogsProps) {
    return (
        <>
            {/* Rename File dialog */}
            {fileDialog.action === 'rename' && fileDialog.ctxItem && (
                <FolderActionDialog
                    open
                    title="Rename File"
                    label="New name"
                    initialValue={fileDialog.ctxItem.displayName}
                    placeholder="Enter new file name"
                    confirmLabel="Rename"
                    submitting={fileDialog.submitting}
                    onClose={closeFileDialog}
                    onConfirm={handleFileRename}
                />
            )}

            {/* Delete File confirmation dialog */}
            {fileDialog.action === 'delete' && fileDialog.ctxItem && (
                <Dialog
                    open
                    onClose={closeFileDialog}
                    title="Delete File"
                    footer={
                        <>
                            <Button variant="secondary" onClick={closeFileDialog}>Cancel</Button>
                            <Button
                                variant="danger"
                                loading={fileDialog.submitting}
                                onClick={handleFileDelete}
                            >
                                Delete
                            </Button>
                        </>
                    }
                >
                    Are you sure you want to delete{' '}
                    <strong>{fileDialog.ctxItem.displayName}</strong>?
                    This cannot be undone.
                </Dialog>
            )}

            {/* Move File dialog */}
            {tree && (
                <FileMoveDialog
                    open={fileMoveDialogOpen}
                    onClose={onCloseMoveDialog}
                    sourceName={fileMoveCtxItem?.displayName ?? null}
                    tree={tree}
                    onConfirm={handleFileMoveConfirm}
                />
            )}
        </>
    );
}
