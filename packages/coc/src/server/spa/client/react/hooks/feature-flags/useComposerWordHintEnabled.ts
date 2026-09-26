import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isComposerWordHintEnabled } from '../../utils/config';

/**
 * Live `features.composerWordHint` flag; tracks runtime config updates.
 * Global admin setting; enabled by default.
 */
export function useComposerWordHintEnabled(): boolean {
    const [enabled, setEnabled] = useState(isComposerWordHintEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isComposerWordHintEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
