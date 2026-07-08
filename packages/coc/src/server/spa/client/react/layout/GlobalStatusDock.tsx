/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * In the remote-first shell the status/action cluster (connection /
 * notifications / quota / admin / theme) lives in a docked bar pinned to the
 * bottom-left of the app, the width of the workspace's left sidebar column, so
 * the controls sit at the left and the connection pill is pushed to the right
 * edge of that column while the detail pane / composer to its right stays clear.
 *
 * The workspace chat/activity sub-tab already docks the cluster inside its own
 * left-column footer (`SplitWorkspacePanel` `footer`), which keeps the chat
 * detail pane full height. This global dock covers every OTHER tab/sub-tab, so
 * it renders null on that view to avoid double-docking. Together they hide the
 * topbar cluster on every desktop remote-shell tab (`TopBar`'s `statusInDock`).
 *
 * Its width tracks the live left-column width published by `SplitWorkspacePanel`
 * via the `--workspace-left-col-width` CSS variable, falling back to the panel's
 * default width where no split sidebar is mounted (e.g. the terminal tab).
 *
 * Rendered once at the App shell level as a flex sibling below `<main>`, so it
 * reserves its own height and never overlaps tab content. Gated to
 * `remoteShell && desktop`:
 *   - classic (non-remote) mode keeps the historic top-right cluster, and
 *   - mobile keeps the compact topbar connection dot (no room for a bottom bar).
 */

import { StatusActions } from './StatusActions';
import { useApp } from '../contexts/AppContext';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { useSplitWorkspacePanelEnabled } from '../hooks/feature-flags/useSplitWorkspacePanelEnabled';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';

/** Fallback width when no split sidebar is mounted (matches the panel default). */
const DEFAULT_LEFT_COL_WIDTH = 360;

export interface GlobalStatusDockProps {
    /** Admin-open handler, forwarded to the docked admin button. */
    onAdminOpen?: () => void;
}

export function GlobalStatusDock({ onAdminOpen }: GlobalStatusDockProps) {
    const { state } = useApp();
    const remoteShell = useRemoteShellEnabled();
    const splitWorkspacePanelEnabled = useSplitWorkspacePanelEnabled();
    const { isMobile } = useBreakpoint();

    if (!remoteShell || isMobile) return null;

    // The workspace chat/activity sub-tab hosts the dock in its own left-column
    // footer so the chat detail pane keeps full height. Don't render a second
    // dock over that view.
    const inPanelFooter =
        splitWorkspacePanelEnabled &&
        state.activeTab === 'repos' &&
        !!state.selectedRepoId &&
        (state.activeRepoSubTab === 'chats' || state.activeRepoSubTab === 'activity');
    if (inPanelFooter) return null;

    return (
        <div
            className="flex-shrink-0"
            style={{ width: `var(--workspace-left-col-width, ${DEFAULT_LEFT_COL_WIDTH}px)` }}
            data-testid="global-status-dock"
        >
            <StatusActions variant="sidebar" onAdminOpen={onAdminOpen} />
        </div>
    );
}
