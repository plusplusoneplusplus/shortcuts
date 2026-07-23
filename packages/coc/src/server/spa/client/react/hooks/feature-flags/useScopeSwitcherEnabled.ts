import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isScopeSwitcherEnabled } from '../../utils/config';

/**
 * Live `features.scopeSwitcher` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Scope slide switcher), the
 * remote-first desktop header replaces the standalone 💼 My Work / 🏠 My Life
 * toggles and the workspace identity chip with a single sliding segmented
 * switcher (My Work · My Life · Active workspace). Global admin setting —
 * applies to the whole deployment. Disabled by default.
 */
export function useScopeSwitcherEnabled(): boolean {
    const [enabled, setEnabled] = useState(isScopeSwitcherEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isScopeSwitcherEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
