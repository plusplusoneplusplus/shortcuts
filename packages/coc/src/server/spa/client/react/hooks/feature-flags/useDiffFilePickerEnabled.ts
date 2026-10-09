import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isDiffFilePickerEnabled } from '../../utils/config';

/**
 * Live `features.diffFilePicker` flag; tracks runtime config updates.
 *
 * When enabled (Admin → Configure → Features → Code Review & Collaboration →
 * Diff header file picker), the file path in a navigable multi-file diff header
 * opens a searchable changed-file picker. Turning it off dismisses any open
 * picker and restores the passive path. Global admin setting; enabled by default.
 */
export function useDiffFilePickerEnabled(): boolean {
    const [enabled, setEnabled] = useState(isDiffFilePickerEnabled());
    useEffect(() => {
        const onConfigUpdated = () => setEnabled(isDiffFilePickerEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);
    return enabled;
}
