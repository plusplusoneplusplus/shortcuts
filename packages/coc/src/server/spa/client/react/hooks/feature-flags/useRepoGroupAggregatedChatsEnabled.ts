import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isRepoGroupAggregatedChatsEnabled } from '../../utils/config';

/**
 * Live `features.repoGroupAggregatedChats` flag; tracks runtime config updates.
 *
 * When enabled, a repo group's Workspace chat list shows group-owned chats and
 * every eligible chat from its member repos. Discovery and navigation only:
 * chats keep their owning workspace, queue and server. Disabled by default.
 */
export function useRepoGroupAggregatedChatsEnabled(): boolean {
    const [enabled, setEnabled] = useState(isRepoGroupAggregatedChatsEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isRepoGroupAggregatedChatsEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
