/**
 * AdminDialog — hosts AdminPanel in a centered overlay dialog.
 *
 * Admin is a dialog rather than a page, so opening the gear leaves the chat /
 * notes / repo view mounted underneath and dims it instead of navigating away.
 * Open/close is driven by the hash via `useAdminDialogRoute`.
 *
 * `AdminPanel` brings its own chrome (brand, nav rail, breadcrumb), so the
 * dialog opts into `borderless`: no frame, no inner padding, and the ×
 * floats over the top-right corner instead of taking a header row.
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
            borderless
            renderHeader={() => (
                <button
                    data-testid="dialog-close-btn"
                    className="absolute top-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/70 dark:bg-black/40 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/5 dark:hover:bg-white/10 text-lg leading-none backdrop-blur-sm"
                    onClick={onClose}
                    aria-label="Close"
                    title="Close"
                >
                    ×
                </button>
            )}
        >
            <AdminPanel />
        </Dialog>
    );
}
