import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isMyWorkTodayViewEnabled } from '../../utils/config';

/**
 * Live `myWork.todayView` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → My Work — Today view), My Work
 * shows an actionable Today tab that lists action items and "waiting on"
 * follow-ups with checkbox toggling and quick-add, and lands there by default.
 * Global admin setting — applies to the whole deployment, takes effect on
 * reload. Disabled by default (Notes stays the landing tab).
 */
export function useMyWorkTodayViewEnabled(): boolean {
    const [enabled, setEnabled] = useState(isMyWorkTodayViewEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isMyWorkTodayViewEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
