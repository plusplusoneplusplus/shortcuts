import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isDiffEngineToggleEnabled } from '../../utils/config';

/**
 * Live, default-off `features.diffEngineToggle` setting. When off, file diff
 * toolbars hide the Classic/Editor switch and diffs use the Editor engine.
 */
export function useDiffEngineToggleEnabled(): boolean {
    const [enabled, setEnabled] = useState(isDiffEngineToggleEnabled);
    useEffect(() => {
        const update = () => setEnabled(isDiffEngineToggleEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        // Catch updates made after render but before the subscription was installed.
        update();
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    return enabled;
}
