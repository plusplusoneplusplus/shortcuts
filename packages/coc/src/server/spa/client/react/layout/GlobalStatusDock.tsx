/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * In the remote-first shell the status/action cluster (connection /
 * notifications / quota / admin / theme) lives in a docked bar pinned to the
 * bottom-left of the app on EVERY tab, instead of the historic top-right topbar
 * cluster. It renders the shared `StatusActions` sidebar variant, but only as
 * wide as the workspace's left sidebar column — the controls sit at the left
 * and the connection pill is pushed to the right edge of that column, leaving
 * the detail pane / composer to its right clear.
 *
 * The width tracks the live left-column width published by `SplitWorkspacePanel`
 * via the `--workspace-left-col-width` CSS variable, falling back to the panel's
 * default width where no split sidebar is mounted (e.g. the terminal tab).
 *
 * Rendered once at the App shell level as a flex sibling below `<main>`, so it
 * reserves its own height and never overlaps tab content. Gated to
 * `remoteShell && desktop`:
 *   - classic (non-remote) mode keeps the historic top-right cluster, and
 *   - mobile keeps the compact topbar connection dot (no room for a bottom bar).
 *
 * Whenever this dock renders, `TopBar` hides its own cluster (same gate) so the
 * two never both show.
 */

import { StatusActions } from './StatusActions';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';

/** Fallback width when no split sidebar is mounted (matches the panel default). */
const DEFAULT_LEFT_COL_WIDTH = 360;

export interface GlobalStatusDockProps {
    /** Admin-open handler, forwarded to the docked admin button. */
    onAdminOpen?: () => void;
}

export function GlobalStatusDock({ onAdminOpen }: GlobalStatusDockProps) {
    const remoteShell = useRemoteShellEnabled();
    const { isMobile } = useBreakpoint();
    if (!remoteShell || isMobile) return null;
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
