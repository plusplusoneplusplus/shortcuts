import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isChatFoldersEnabled } from '../../utils/config';

/**
 * Live `features.chatFolders` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Chat folders), the chat list
 * grows a user-created folder tree: a named, colored folder that chats and task
 * rows are filed into by drag or context menu, and that collapses away when not
 * needed. Gates UI only — the folder REST routes and the schema migration ship
 * regardless, so filing survives the flag being turned off and back on.
 * Global admin setting; disabled by default.
 */
export function useChatFoldersEnabled(): boolean {
    const [enabled, setEnabled] = useState(isChatFoldersEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isChatFoldersEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
