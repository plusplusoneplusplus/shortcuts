/**
 * adminDialogRoute — pure policy for the admin overlay dialog.
 *
 * Admin is a dialog, not a page: the gear leaves the current view mounted and
 * opens `AdminPanel` in a centered overlay. The hash stays the source of truth,
 * so "is the dialog open" is *derived* from the routed tab rather than held as
 * independent React state — back/forward and deep links then work for free.
 *
 * Kept free of React so the routing rules stay unit-testable on their own.
 */

import { tabFromHash } from '../layout/dashboardRoutes';
import type { DashboardTab } from '../types/dashboard';

/**
 * Dashboard tabs hosted by the admin shell. `admin` is the shell itself; the
 * rest are tool views that `AdminPanel` embeds in its right pane, so they all
 * belong inside the same dialog.
 */
export const ADMIN_SHELL_TABS: ReadonlySet<DashboardTab> = new Set<DashboardTab>([
    'admin',
    'memory',
    'skills',
    'logs',
    'stats',
    'servers',
    'dreams-admin',
]);

/** Hash used when the dialog is closed with no previous non-admin route to go back to. */
export const DEFAULT_NON_ADMIN_HASH = '#repos';

export function isAdminShellTab(tab: DashboardTab | null | undefined): boolean {
    return !!tab && ADMIN_SHELL_TABS.has(tab);
}

/** True when `hash` routes to any tab the admin dialog owns. */
export function isAdminShellHash(hash: string | null | undefined): boolean {
    if (!hash) return false;
    return isAdminShellTab(tabFromHash(hash));
}

/**
 * Where closing the dialog should land. Restores the last non-admin hash the
 * user was on; a cold deep link (`#admin/database/...` pasted into a fresh tab)
 * has no such hash, so it falls back to the app default instead of a blank screen.
 */
export function resolveAdminCloseHash(previous: string | null | undefined): string {
    if (!previous || isAdminShellHash(previous)) return DEFAULT_NON_ADMIN_HASH;
    return previous.startsWith('#') ? previous : '#' + previous;
}
