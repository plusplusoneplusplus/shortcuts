import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isRailManualRefreshEnabled } from '../../utils/config';

/**
 * Live `features.railManualRefresh` flag; tracks runtime config updates.
 * Gates the collapsed workspace rail's manual refresh control.
 * Global admin setting; enabled by default.
 */
export function useRailManualRefreshEnabled(): boolean {
    const [enabled, setEnabled] = useState(isRailManualRefreshEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isRailManualRefreshEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
