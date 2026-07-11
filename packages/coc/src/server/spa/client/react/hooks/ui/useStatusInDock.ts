import { useRemoteShellEnabled } from '../feature-flags/useRemoteShellEnabled';
import { useBreakpoint } from './useBreakpoint';

/**
 * True when the shared status/action cluster (connection / notifications /
 * quota / admin / theme) should be docked into the shell chrome rather than the
 * top-right topbar corner — i.e. the remote-first shell on desktop.
 *
 * Centralises the gate so every host of the docked cluster agrees:
 *   - `TopBar` hides its top-right cluster (`statusInDock`),
 *   - `GlobalStatusDock` renders the app-wide bottom band,
 *   - the Admin sidebar, Notes, Settings, and My Work view dock the cluster in
 *     their own chrome (`DockedStatusFooter`).
 *
 * Off (classic mode) or on mobile the topbar keeps the cluster, so this is
 * false and none of the docked hosts render.
 */
export function useStatusInDock(): boolean {
    const remoteShell = useRemoteShellEnabled();
    const { isMobile } = useBreakpoint();
    return remoteShell && !isMobile;
}
