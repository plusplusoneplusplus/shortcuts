/**
 * LogsDialog — wraps LogsView inside an overlay Dialog (same pattern as AdminDialog).
 */

import { lazy, Suspense } from 'react';
import { Dialog } from '../../shared/Dialog';

const LogsView = lazy(() => import('./LogsView').then(m => ({ default: m.LogsView })));

export interface LogsDialogProps {
    open: boolean;
    onClose: () => void;
}

export function LogsDialog({ open, onClose }: LogsDialogProps) {
    if (!open) return null;
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Logs"
            className="max-w-[1100px]"
            id="logs-dialog"
        >
            <div className="overflow-y-auto max-h-[80vh]">
                <Suspense fallback={<div className="flex items-center justify-center h-40 text-[#888]">Loading…</div>}>
                    <LogsView />
                </Suspense>
            </div>
        </Dialog>
    );
}
