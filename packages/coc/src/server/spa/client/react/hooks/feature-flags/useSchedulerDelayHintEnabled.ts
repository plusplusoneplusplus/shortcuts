import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isSchedulerDelayHintEnabled } from '../../utils/config';

/** Live, default-on appearance setting; does not control scheduler execution. */
export function useSchedulerDelayHintEnabled(): boolean {
    const [enabled, setEnabled] = useState(() => isSchedulerDelayHintEnabled());
    useEffect(() => {
        const update = () => setEnabled(isSchedulerDelayHintEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    return enabled;
}
