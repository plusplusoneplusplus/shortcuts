/**
 * useAdminDialogRoute — binds the admin overlay dialog to the hash route.
 *
 * `open` is derived from the routed tab (never stored), so `#admin`,
 * `#admin/settings/appearance`, `#admin/database/processes?page=2` and the
 * embedded tool routes all open the dialog, and browser back/forward moves
 * through admin sections without ever closing it.
 *
 * Closing restores the last non-admin hash the user was on. See
 * `adminDialogRoute` for the pure rules.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { isAdminShellHash, isAdminShellTab, resolveAdminCloseHash } from './adminDialogRoute';

export interface AdminDialogRoute {
    open: boolean;
    close: () => void;
}

export function useAdminDialogRoute(): AdminDialogRoute {
    const { state } = useApp();
    const open = isAdminShellTab(state.activeTab);

    // The hash to return to on close. Recorded from `location.hash` rather than
    // from `state.activeTab` so the full deep link (repo, sub-tab, selected
    // chat) is restored, not just the tab.
    const previousHashRef = useRef<string>('');

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const record = () => {
            if (!isAdminShellHash(window.location.hash)) {
                previousHashRef.current = window.location.hash;
            }
        };
        record();
        window.addEventListener('hashchange', record);
        return () => window.removeEventListener('hashchange', record);
    }, []);

    const close = useCallback(() => {
        window.location.hash = resolveAdminCloseHash(previousHashRef.current);
    }, []);

    return { open, close };
}
