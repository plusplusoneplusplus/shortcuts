/**
 * TasksFolderDialogs — rename, create-subfolder, create-task, delete, and move folder dialog portals.
 */

import type { FolderDialogAction } from '../hooks/useFolderDialogHandlers';
import type { TaskFolder } from '../hooks/useTaskTree';
import { FolderActionDialog } from './FolderActionDialog';
import { FolderMoveDialog } from './FolderMoveDialog';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';

interface TasksFolderDialogsProps {
    tree: TaskFolder | null;
    folderDialog: { action: FolderDialogAction; folder: TaskFolder | null; submitting: boolean };
    closeFolderDialog: () => void;
    handleRename: (newName: string) => Promise<void>;
    handleCreateSubfolder: (name: string) => Promise<void>;
    handleCreateTask: (taskName: string, docType?: string) => Promise<void>;
    handleDelete: () => Promise<void>;
    moveDialogOpen: boolean;
    moveSourceFolder: TaskFolder | null;
    onCloseMoveDialog: () => void;
    handleMoveConfirm: (dest: string) => Promise<void>;
}

export function TasksFolderDialogs({
    tree,
    folderDialog,
    closeFolderDialog,
    handleRename,
    handleCreateSubfolder,
    handleCreateTask,
    handleDelete,
    moveDialogOpen,
    moveSourceFolder,
    onCloseMoveDialog,
    handleMoveConfirm,
}: TasksFolderDialogsProps) {
    return (
        <>
            {/* Rename Folder dialog */}
            {folderDialog.action === 'rename' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title="Rename Folder"
                    label="New name"
                    initialValue={folderDialog.folder.name}
                    placeholder="Enter new folder name"
                    confirmLabel="Rename"
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={handleRename}
                />
            )}

            {/* Create Subfolder dialog */}
            {folderDialog.action === 'create-subfolder' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title="Create Subfolder"
                    label="Subfolder name"
                    initialValue=""
                    placeholder="Enter subfolder name"
                    confirmLabel="Create"
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={handleCreateSubfolder}
                />
            )}

            {/* Create Task in Folder dialog (or at root when folder is tree) */}
            {folderDialog.action === 'create-task' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title={folderDialog.folder.relativePath ? 'Create Task in Folder' : 'Create Task'}
                    label="Task name"
                    initialValue=""
                    placeholder="Enter task name"
                    confirmLabel="Create"
                    showDocType
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={(name, docType) => handleCreateTask(name, docType)}
                />
            )}

            {/* Delete Folder confirmation dialog */}
            {folderDialog.action === 'delete' && folderDialog.folder && (
                <Dialog
                    open
                    onClose={closeFolderDialog}
                    title="Delete Folder"
                    footer={
                        <>
                            <Button variant="secondary" onClick={closeFolderDialog}>Cancel</Button>
                            <Button
                                variant="danger"
                                loading={folderDialog.submitting}
                                onClick={handleDelete}
                            >
                                Delete
                            </Button>
                        </>
                    }
                >
                    Are you sure you want to delete{' '}
                    <strong>{folderDialog.folder.name}</strong> and all its contents?
                    This cannot be undone.
                </Dialog>
            )}

            {/* Move Folder dialog */}
            {tree && (
                <FolderMoveDialog
                    open={moveDialogOpen}
                    onClose={onCloseMoveDialog}
                    sourceFolder={moveSourceFolder}
                    tree={tree}
                    onConfirm={handleMoveConfirm}
                />
            )}
        </>
    );
}
