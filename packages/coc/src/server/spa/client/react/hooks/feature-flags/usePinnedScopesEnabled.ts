import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isPinnedScopesEnabled } from '../../utils/config';

/**
 * Live `features.pinnedScopes` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Pinned scope segments), the
 * scope slide switcher gains user-pinned repo / repo-group segments between the
 * virtual scopes and the workspace chip, and the workspace picker rows gain a
 * pin toggle. Only meaningful alongside `features.scopeSwitcher`, which owns the
 * switcher itself. Global admin setting. Disabled by default.
 */
export function usePinnedScopesEnabled(): boolean {
    const [enabled, setEnabled] = useState(isPinnedScopesEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isPinnedScopesEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
