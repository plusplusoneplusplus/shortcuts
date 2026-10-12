import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../utils/config';

/** Live, default-off appearance setting; does not control scheduler execution. */
export function useSchedulerDelayHintEnabled(): boolean {
    const [enabled, setEnabled] = useState(() => isFeatureEnabled('schedulerDelayHintEnabled'));
    useEffect(() => {
        const update = () => setEnabled(isFeatureEnabled('schedulerDelayHintEnabled'));
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    return enabled;
}
