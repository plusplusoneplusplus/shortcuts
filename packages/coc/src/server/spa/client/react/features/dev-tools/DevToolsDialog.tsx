/**
 * DevToolsDialog — wraps DevToolsPanel in an overlay Dialog, mirroring
 * AdminDialog. Unmounting on close is what resets the panel's in-memory state.
 */

import { Dialog } from '../../ui/Dialog';
import { DevToolsPanel } from './DevToolsPanel';

export interface DevToolsDialogProps {
    open: boolean;
    onClose: () => void;
}

export function DevToolsDialog({ open, onClose }: DevToolsDialogProps) {
    if (!open) return null;
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Dev Tools"
            className="max-w-[900px]"
            id="dev-tools-dialog"
        >
            <DevToolsPanel />
        </Dialog>
    );
}
