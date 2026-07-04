import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isSingleRowShellEnabled } from '../../utils/config';

/**
 * Live `features.singleRowShell` flag; tracks runtime config updates.
 *
 * When enabled alongside `features.remoteShell`, desktop repo navigation moves
 * from the two-row remote shell into the global TopBar.
 */
export function useSingleRowShellEnabled(): boolean {
    const [enabled, setEnabled] = useState(isSingleRowShellEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isSingleRowShellEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
