/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * In the remote-first shell the status/action cluster (connection /
 * notifications / quota / admin / theme) lives in a docked bar pinned to the
 * bottom of the app on EVERY tab, instead of the historic top-right topbar
 * cluster. It renders the shared `StatusActions` sidebar variant full-width — a
 * VS Code-style status bar with the controls at the left and the connection
 * pill pushed to the right edge.
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

export interface GlobalStatusDockProps {
    /** Admin-open handler, forwarded to the docked admin button. */
    onAdminOpen?: () => void;
}

export function GlobalStatusDock({ onAdminOpen }: GlobalStatusDockProps) {
    const remoteShell = useRemoteShellEnabled();
    const { isMobile } = useBreakpoint();
    if (!remoteShell || isMobile) return null;
    return <StatusActions variant="sidebar" onAdminOpen={onAdminOpen} />;
}
