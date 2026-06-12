import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isNativeCopilotSessionsEnabled } from '../../utils/config';

/** Live `features.nativeCopilotSessions` flag; tracks runtime config updates. */
export function useNativeCopilotSessionsEnabled(): boolean {
    const [enabled, setEnabled] = useState(isNativeCopilotSessionsEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isNativeCopilotSessionsEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
