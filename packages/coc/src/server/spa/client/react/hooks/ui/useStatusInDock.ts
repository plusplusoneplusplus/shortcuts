import { useRemoteShellEnabled } from '../feature-flags/useRemoteShellEnabled';
import { useBreakpoint } from './useBreakpoint';

/**
 * True when the shared status/action cluster (connection / notifications /
 * quota / admin / theme) should be docked into the shell chrome rather than the
 * top-right topbar corner — i.e. the remote-first shell on desktop.
 *
 * Off (classic mode) or on mobile the topbar keeps the cluster, so this is
 * false and none of the docked hosts render.
 */
export function useStatusInDock(): boolean {
    const remoteShell = useRemoteShellEnabled();
    const { isMobile } = useBreakpoint();
    return remoteShell && !isMobile;
}
