import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isUnifiedRightPanelEnabled } from '../../utils/config';

/**
 * Live `features.unifiedRightPanel` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Unified right panel), the
 * desktop workspace dock and the chat-opened file / canvas / diff columns
 * converge on ONE resource-tabbed right panel: workspace-owned Terminal,
 * Explorer, and Notes tabs plus chat-owned file, canvas, and diff tabs. Off by
 * default, in which case every existing right-side surface keeps its current
 * behavior. Global admin setting; applies to the whole deployment and takes
 * effect on reload.
 */
export function useUnifiedRightPanelEnabled(): boolean {
    const [enabled, setEnabled] = useState(isUnifiedRightPanelEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isUnifiedRightPanelEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
