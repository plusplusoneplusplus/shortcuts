/**
 * useVisibleDashboardTab — the tab actually on screen.
 *
 * Admin is an overlay dialog, not a page: while an admin hash is routed
 * (`#admin`, `#logs`, `#admin/database/...`, …) `state.activeTab` names the
 * admin view, but the page *behind* the dialog is still the last non-admin tab
 * the user was on. Anything that decides what the page shows — which view
 * Router mounts, whether the app-wide status dock stands down — has to look at
 * that tab, not at `activeTab`.
 *
 * Seeded with the app default so a cold deep link straight to `#admin` still
 * has something to render underneath.
 */

import { useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { isAdminShellTab } from '../admin/adminDialogRoute';
import type { DashboardTab } from '../types/dashboard';

/** Tab shown behind the dialog when admin is deep-linked into a fresh tab. */
export const DEFAULT_VISIBLE_TAB: DashboardTab = 'repos';

export function useVisibleDashboardTab(): DashboardTab {
    const { state } = useApp();
    const lastNonAdminTabRef = useRef<DashboardTab>(DEFAULT_VISIBLE_TAB);
    if (!isAdminShellTab(state.activeTab)) {
        lastNonAdminTabRef.current = state.activeTab;
    }
    return isAdminShellTab(state.activeTab) ? lastNonAdminTabRef.current : state.activeTab;
}
