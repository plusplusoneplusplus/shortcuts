/**
 * DevToolsDialog — wraps DevToolsPanel in an overlay Dialog, mirroring
 * AdminDialog. Unmounting on close is what resets the panel's in-memory state.
 *
 * The header carries a pop-out button that reopens the panel as its own window
 * (`#popout/dev-tools`) and closes the dialog, so a tool can stay on screen
 * while the user works in the main window.
 */

import { Dialog } from '../../ui/Dialog';
import { DevToolsPanel } from './DevToolsPanel';
import { popOutOpened } from '../../utils/popOutWindow';
import { DEV_TOOLS_POPOUT_WINDOW_NAME, devToolsPopOutUrl } from '../../layout/PopOutDevToolsShell';

export interface DevToolsDialogProps {
    open: boolean;
    onClose: () => void;
}

export function DevToolsDialog({ open, onClose }: DevToolsDialogProps) {
    if (!open) return null;

    const handlePopOut = () => {
        const handle = window.open(
            devToolsPopOutUrl(),
            DEV_TOOLS_POPOUT_WINDOW_NAME,
            'width=900,height=900',
        );
        // On Electron the open is intercepted into a native window and returns
        // null even though a window appeared (see popOutOpened) — only a real
        // block should leave the dialog up.
        if (!popOutOpened(handle)) return;
        onClose();
    };

    const renderHeader = () => (
        <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Dev Tools</h2>
            <button
                data-testid="dev-tools-popout-btn"
                className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm leading-none px-1"
                onClick={handlePopOut}
                aria-label="Open in new window"
                title="Open in new window"
            >
                ⧉
            </button>
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
    );

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Dev Tools"
            renderHeader={renderHeader}
            className="max-w-[900px]"
            id="dev-tools-dialog"
        >
            <DevToolsPanel />
        </Dialog>
    );
}
