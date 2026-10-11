import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isRailStatusActionsEnabled } from '../../utils/config';

/**
 * Live `features.railStatusActions` flag; tracks runtime config updates.
 * Gates the collapsed workspace rail's Admin and quota shortcuts.
 * Global admin setting; disabled by default.
 */
export function useRailStatusActionsEnabled(): boolean {
    const [enabled, setEnabled] = useState(isRailStatusActionsEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isRailStatusActionsEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
