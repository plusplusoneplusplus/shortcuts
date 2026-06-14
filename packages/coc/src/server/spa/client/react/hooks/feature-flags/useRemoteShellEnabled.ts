import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isRemoteShellEnabled } from '../../utils/config';

/**
 * Live `features.remoteShell` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Remote-first shell), the desktop
 * dashboard switches from per-clone repo tabs to a remote-first two-row shell.
 * Global admin setting — applies to the whole deployment, takes effect on reload.
 */
export function useRemoteShellEnabled(): boolean {
    const [enabled, setEnabled] = useState(isRemoteShellEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isRemoteShellEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
