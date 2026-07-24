import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isQuickAskSidenotesEnabled } from '../../utils/config';

/**
 * Live `features.quickAskSidenotes` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Quick Ask side-notes), selecting
 * text in a completed assistant turn surfaces the ✨ Ask AI pill, chip row, and
 * side-note popover. Experimental, disabled by default. The setting is
 * `runtime: 'live'`, so toggling it takes effect immediately — no reload needed.
 */
export function useQuickAskSidenotesEnabled(): boolean {
    const [enabled, setEnabled] = useState(isQuickAskSidenotesEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isQuickAskSidenotesEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
