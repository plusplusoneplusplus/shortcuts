import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isRailGitSummaryEnabled } from '../../utils/config';

/**
 * Live `features.railGitSummary` flag; tracks runtime config updates.
 * Gates the collapsed workspace rail's Git tiles and the reads behind them.
 * Global admin setting; disabled by default.
 */
export function useRailGitSummaryEnabled(): boolean {
    const [enabled, setEnabled] = useState(isRailGitSummaryEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isRailGitSummaryEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
