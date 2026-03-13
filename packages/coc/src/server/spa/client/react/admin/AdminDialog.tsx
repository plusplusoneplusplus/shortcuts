/**
 * AdminDialog — wraps AdminPanel inside an overlay Dialog.
 */

import { Dialog } from '../shared/Dialog';
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
            title="Admin"
            className="max-w-[900px]"
            id="admin-dialog"
        >
            <div className="overflow-y-auto max-h-[80vh]">
                <AdminPanel />
            </div>
        </Dialog>
    );
}
