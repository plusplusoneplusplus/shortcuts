import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isSchedulesInScheduledSlideEnabled } from '../../utils/config';

/**
 * Live `features.schedulesInScheduledSlide` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Schedules in Scheduled slide),
 * the chat-list "Scheduled" slide gains schedule-management surfaces — a list of
 * schedule definitions with create/edit/run/pause/delete + run history opening in
 * the main pane — and the standalone Schedules tab is hidden and redirected.
 * Global admin setting; applies to the whole deployment and takes effect on
 * reload. Enabled by default.
 */
export function useSchedulesInScheduledSlideEnabled(): boolean {
    const [enabled, setEnabled] = useState(isSchedulesInScheduledSlideEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isSchedulesInScheduledSlideEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
