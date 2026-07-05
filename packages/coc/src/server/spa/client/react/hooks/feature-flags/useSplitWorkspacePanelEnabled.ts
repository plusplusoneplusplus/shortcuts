import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isSplitWorkspacePanelEnabled } from '../../utils/config';

/**
 * Live `features.splitWorkspacePanel` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Split Workspace panel), the
 * dashboard replaces the Activity tab with a split "Workspace" view — chat list
 * on top, git on the bottom — that both feed one shared detail pane, and hides
 * the standalone Git tab. Global admin setting; applies to the whole deployment
 * and takes effect on reload. Disabled by default.
 */
export function useSplitWorkspacePanelEnabled(): boolean {
    const [enabled, setEnabled] = useState(isSplitWorkspacePanelEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isSplitWorkspacePanelEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
