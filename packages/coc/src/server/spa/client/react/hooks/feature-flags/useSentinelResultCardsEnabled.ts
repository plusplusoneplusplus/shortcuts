import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, getFeatureValue } from '../../utils/config';

/** Default-on page-wide presentation preference; does not change the owner's execution capabilities. */
export function useSentinelResultCardsEnabled(): boolean {
    const read = () => getFeatureValue('sentinelResultCardsEnabled') !== false;
    const [enabled, setEnabled] = useState(read);
    useEffect(() => {
        const update = () => setEnabled(read());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    return enabled;
}
