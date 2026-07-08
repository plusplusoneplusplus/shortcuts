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
 * The admin shell (the `admin` tab plus the embedded tool tabs) is the exception:
 * it renders its OWN fixed-width sidebar (`--ar-sidebar-w`, 248px) rather than the
 * resizable workspace left column, and never publishes `--workspace-left-col-width`.
 * On those tabs the dock tracks the admin sidebar width so it stays flush beneath
 * that sidebar instead of overhanging into the content pane.
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

/**
 * Width of the admin shell's own sidebar. Mirrors `--ar-sidebar-w` in
 * admin-redesign.css; the dock sits outside `.admin-redesign` so it cannot read
 * that scoped variable and pins the constant here instead.
 */
const ADMIN_SIDEBAR_WIDTH = 248;

/**
 * Dashboard tabs whose Router branch mounts `AdminPanel` (the fixed-width admin
 * sidebar shell). On these the dock matches the admin sidebar, not the workspace
 * left column. Keep in sync with the admin cases in Router's `renderActiveView`.
 */
const ADMIN_SHELL_TABS = new Set(['admin', 'memory', 'skills', 'logs', 'stats', 'servers', 'dreams-admin']);

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

    // In the admin shell the dock follows the admin sidebar's fixed width so it
    // stays flush beneath it; elsewhere it tracks the resizable workspace left
    // column (or the panel default when no split sidebar is mounted).
    const width = ADMIN_SHELL_TABS.has(state.activeTab)
        ? `${ADMIN_SIDEBAR_WIDTH}px`
        : `var(--workspace-left-col-width, ${DEFAULT_LEFT_COL_WIDTH}px)`;

    return (
        <div
            className="flex-shrink-0"
            style={{ width }}
            data-testid="global-status-dock"
        >
            <StatusActions variant="sidebar" onAdminOpen={onAdminOpen} />
        </div>
    );
}
