/**
 * DockedStatusFooter — hosts the shared status/action cluster
 * (`StatusActions` `variant="sidebar"`) at the bottom of a page's own left
 * column, matching the workspace chat view (`SplitWorkspacePanel` footer).
 *
 * Pages that own their own left sidebar (the Admin shell, Notes, Settings)
 * render this at the bottom of that chrome so the status cluster lives inside
 * the sidebar and the content pane extends full height — instead of the
 * app-wide `GlobalStatusDock` painting a partial-width bottom band with an
 * empty strip beside it.
 *
 * Renders nothing unless the remote-first shell is on (desktop), so classic /
 * mobile keep the topbar cluster. It also no-ops when rendered outside a
 * `ThemeProvider` (e.g. isolated component tests) since the cluster is app-shell
 * chrome that only makes sense inside the full provider tree.
 */

import { StatusActions } from './StatusActions';
import { useStatusInDock } from '../hooks/ui/useStatusInDock';
import { useThemeOptional } from './ThemeProvider';

export interface DockedStatusFooterProps {
    /** Admin-open handler forwarded to the docked admin button. Defaults to
     *  navigating to `#admin` (handled by `StatusActions`). */
    onAdminOpen?: () => void;
}

export function DockedStatusFooter({ onAdminOpen }: DockedStatusFooterProps) {
    const inDock = useStatusInDock();
    const theme = useThemeOptional();
    if (!inDock || !theme) return null;
    return <StatusActions variant="sidebar" onAdminOpen={onAdminOpen} />;
}
