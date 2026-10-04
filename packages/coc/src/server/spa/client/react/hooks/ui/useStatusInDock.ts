import { useBreakpoint } from './useBreakpoint';

/**
 * True when the shared status/action cluster (connection / notifications /
 * quota / admin / theme) should be docked into the shell chrome rather than the
 * top-right topbar corner — i.e. the desktop shell. On mobile the topbar keeps
 * the cluster, so none of the docked hosts render.
 */
export function useStatusInDock(): boolean {
    const { isMobile } = useBreakpoint();
    return !isMobile;
}
