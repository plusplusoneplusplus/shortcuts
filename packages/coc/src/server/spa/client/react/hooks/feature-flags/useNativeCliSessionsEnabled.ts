import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isNativeCliSessionsEnabled } from '../../utils/config';

/** Live `features.nativeCliSessions` flag; tracks runtime config updates. */
export function useNativeCliSessionsEnabled(): boolean {
    const [enabled, setEnabled] = useState(isNativeCliSessionsEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isNativeCliSessionsEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
