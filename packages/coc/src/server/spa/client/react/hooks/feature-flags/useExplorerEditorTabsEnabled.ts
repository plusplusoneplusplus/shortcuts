import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isExplorerEditorTabsEnabled } from '../../utils/config';

/**
 * Live `features.explorerEditorTabs` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Explorer editor tabs), the File
 * Explorer's editor area grows a VS Code-style tab strip: a single italic
 * preview tab that subsequent single clicks replace, pinned tabs from a double
 * click or the first edit, drag reordering, MRU cycling, and a tab session
 * restored per workspace. With the flag off the Explorer keeps its current
 * single replaceable preview pane.
 *
 * Gates UI only — tab state lives in per-workspace local storage, so nothing
 * server-side depends on the flag. Global admin setting; disabled by default.
 */
export function useExplorerEditorTabsEnabled(): boolean {
    const [enabled, setEnabled] = useState(isExplorerEditorTabsEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isExplorerEditorTabsEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
