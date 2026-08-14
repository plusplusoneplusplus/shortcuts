/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * In the remote-first shell the status/action cluster (connection /
 * notifications / quota / admin / theme) lives in a docked bar pinned to the
 * bottom-left of the app, the width of the workspace's left sidebar column, so
 * the controls sit at the left and the connection pill is pushed to the right
 * edge of that column while the detail pane / composer to its right stays clear.
 *
 * Pages that own their own left sidebar dock the cluster in that sidebar's own
 * footer instead, so the content pane keeps full height and no partial-width
 * band is painted beneath it:
 *   - the workspace chat/activity sub-tab (`SplitWorkspacePanel` `footer`),
 *   - the workspace notes sub-tab (`NotesView`'s own `NotesSidebar` footer),
 *   - the workspace settings sub-tab (`RepoSettingsTab`'s own nav footer),
 *   - the workspace pull-requests sub-tab (`PullRequestsTab`'s PR queue footer),
 *   - the workspace notes-git sub-tab (`NotesGitTab`'s commit-history sidebar).
 * This global dock covers every OTHER tab/sub-tab, so it renders null on those
 * views to avoid double-docking. Together they hide the topbar cluster on every
 * desktop remote-shell tab (`TopBar`'s `statusInDock`).
 *
 * Admin is an overlay dialog rather than a page, so it gets no stand-down: the
 * page behind the dialog keeps its own dock (and the admin sidebar no longer
 * hosts one). Which page that is comes from `useVisibleDashboardTab`, not from
 * `state.activeTab` — otherwise opening admin over e.g. Notes would flip the
 * sub-tab stand-downs off and paint a second dock under the note editor.
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
import { useVisibleDashboardTab } from './useVisibleDashboardTab';
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
    // The page behind the admin dialog, which is what the dock sits under.
    const visibleTab = useVisibleDashboardTab();

    if (!remoteShell || isMobile) return null;

    // The workspace chat/activity sub-tab hosts the dock in its own left-column
    // footer so the chat detail pane keeps full height. Don't render a second
    // dock over that view.
    const inPanelFooter =
        splitWorkspacePanelEnabled &&
        visibleTab === 'repos' &&
        !!state.selectedRepoId &&
        (state.activeRepoSubTab === 'chats' || state.activeRepoSubTab === 'activity');
    if (inPanelFooter) return null;

    // The notes sub-tab hosts the cluster in `NotesView`'s own left-column
    // footer (the `NotesSidebar` `DockedStatusFooter`), so the note editor pane
    // keeps full height. Don't paint a second partial-width band — with an empty
    // strip beside it — beneath the editor. Applies to regular repos, My Life,
    // and My Work alike, since My Work now docks per-sub-tab like a regular repo.
    const inNotesSidebarFooter =
        visibleTab === 'repos' &&
        !!state.selectedRepoId &&
        state.activeRepoSubTab === 'notes';
    if (inNotesSidebarFooter) return null;

    // The settings sub-tab hosts the cluster in `RepoSettingsTab`'s own nav
    // footer, matching Notes/Admin owned-sidebar behavior.
    const inSettingsSidebarFooter =
        visibleTab === 'repos' &&
        !!state.selectedRepoId &&
        state.activeRepoSubTab === 'settings';
    if (inSettingsSidebarFooter) return null;

    // The notes-git sub-tab (My Work / My Life) hosts the cluster at the bottom
    // of `NotesGitTab`'s own commit-history sidebar, so the diff detail pane
    // keeps full height. Stand down like Notes/Settings.
    const inNotesGitSidebarFooter =
        visibleTab === 'repos' &&
        !!state.selectedRepoId &&
        state.activeRepoSubTab === 'git';
    if (inNotesGitSidebarFooter) return null;

    // The pull-requests sub-tab hosts the cluster at the bottom of its own PR
    // queue sidebar (`PullRequestsTab` docks a `DockedStatusFooter` there). Its
    // queue column is independently resizable (`pr-left-panel-width`), so the
    // global band would neither match its width nor belong under the detail
    // pane — stand down like Notes/Settings.
    const inPrQueueFooter =
        visibleTab === 'repos' &&
        !!state.selectedRepoId &&
        state.activeRepoSubTab === 'pull-requests';
    if (inPrQueueFooter) return null;

    // Tracks the resizable workspace left column (or the panel default when no
    // split sidebar is mounted) so the band stays flush under that column.
    const width = `var(--workspace-left-col-width, ${DEFAULT_LEFT_COL_WIDTH}px)`;

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
