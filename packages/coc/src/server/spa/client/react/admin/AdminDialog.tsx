/**
 * AdminDialog — hosts AdminPanel in a centered overlay dialog.
 *
 * Admin is a dialog rather than a page, so opening the gear leaves the chat /
 * notes / repo view mounted underneath and dims it instead of navigating away.
 * Open/close is driven by the hash via `useAdminDialogRoute`.
 *
 * `AdminPanel` brings its own chrome (brand, nav rail, breadcrumb), so the
 * built-in Dialog header is replaced by a bare × row — no duplicate title.
 */

import { Dialog } from '../ui/Dialog';
import { AdminPanel } from './AdminPanel';

export interface AdminDialogProps {
    open: boolean;
    onClose: () => void;
}

export function AdminDialog({ open, onClose }: AdminDialogProps) {
    if (!open) return null;
    return (
        <Dialog
            open={open}
            onClose={onClose}
            className="admin-dialog-panel max-w-[1100px] h-[85vh]"
            id="admin-dialog"
            dense
            renderHeader={() => (
                <div className="flex items-center justify-end">
                    <button
                        data-testid="dialog-close-btn"
                        className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1"
                        onClick={onClose}
                        aria-label="Close"
                        title="Close"
                    >
                        ×
                    </button>
                </div>
            )}
        >
            <AdminPanel />
        </Dialog>
    );
}
