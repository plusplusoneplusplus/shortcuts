import { Dialog, Button } from '../../../ui';
import type { TreeEntry } from './types';

export interface ExplorerDeleteDialogProps {
    entry: TreeEntry;
    workspaceId: string;
    pending: boolean;
    blockedPaths: readonly string[];
    error: string | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ExplorerDeleteDialog({
    entry, workspaceId, pending, blockedPaths, error, onConfirm, onCancel,
}: ExplorerDeleteDialogProps) {
    const blocked = blockedPaths.length > 0;
    return (
        <Dialog
            open
            trapFocus
            title={blocked ? 'Cannot delete unsaved files' : 'Permanently delete?'}
            id="explorer-delete-dialog"
            disableClose={pending}
            onClose={() => { if (!pending) onCancel(); }}
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        data-dialog-initial-focus
                        disabled={pending}
                        onClick={onCancel}
                        className="rounded border border-[#c8c8c8] px-3 py-2 text-sm disabled:opacity-50 dark:border-[#555]"
                    >Cancel</button>
                    <Button variant="danger" onClick={onConfirm} disabled={blocked || pending} loading={pending}>
                        {pending ? 'Deleting...' : 'Delete permanently'}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-xs text-[#848484] break-all">Workspace: {workspaceId}</p>
                <p className="font-mono text-sm break-all" data-testid="explorer-delete-path">{entry.path}</p>
                <p>This deletion is permanent and cannot be undone.</p>
                {entry.type === 'dir' && <p>Deleting this folder removes all its contents.</p>}
                <p className="text-xs text-[#848484]">
                    Unsaved-edit protection applies to this window only. Save or discard changes in other windows first.
                </p>
                {blocked && (
                    <div role="alert">
                        <p>Save or discard changes and wait for saves to finish before deleting:</p>
                        <ul className="max-h-40 overflow-auto">
                            {blockedPaths.map(path => <li key={path} className="break-all font-mono text-xs">{path}</li>)}
                        </ul>
                    </div>
                )}
                {pending && <p role="status">Deleting the selected entry...</p>}
                {error && <p role="alert" className="text-[#d32f2f] dark:text-[#f48771] break-words">{error}</p>}
            </div>
        </Dialog>
    );
}
