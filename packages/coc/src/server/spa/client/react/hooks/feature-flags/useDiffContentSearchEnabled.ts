import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isDiffContentSearchEnabled } from '../../utils/config';

/** Live, default-off `features.diffContentSearch` setting. */
export function useDiffContentSearchEnabled(): boolean {
    const [enabled, setEnabled] = useState(isDiffContentSearchEnabled);
    useEffect(() => {
        const update = () => setEnabled(isDiffContentSearchEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    return enabled;
}
