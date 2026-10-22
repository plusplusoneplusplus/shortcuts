import { useEffect, useState } from 'react';
import { normalizeApiBasePath } from '@plusplusoneplusplus/coc-client';
import { DASHBOARD_CONFIG_UPDATED_EVENT, getFeatureValue } from '../../utils/config';

/**
 * Resolve the default-on policy. Locally only an explicit false disables it;
 * a remote owner must advertise the flag, since older owners lack the feature.
 */
export function useSentinelNextStepsEnabled(baseUrl?: string): boolean {
    const read = () => getFeatureValue('sentinelNextStepsEnabled') !== false;
    const [localEnabled, setLocalEnabled] = useState(read);
    const [remote, setRemote] = useState<{ baseUrl: string; enabled: boolean }>();
    useEffect(() => {
        const update = () => setLocalEnabled(read());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    useEffect(() => {
        if (!baseUrl) return;
        let cancelled = false;
        const apiBasePath = (window as Window & { __DASHBOARD_CONFIG__?: { apiBasePath?: string } })
            .__DASHBOARD_CONFIG__?.apiBasePath;
        const url = `${baseUrl.replace(/\/+$/, '')}${normalizeApiBasePath(apiBasePath)}/config/runtime`;
        void (async () => {
            let enabled = false;
            try {
                const response = await fetch(url);
                if (response.ok) enabled = (await response.json())?.features?.sentinelNextStepsEnabled === true;
            } catch { /* Owners that are unreachable or do not advertise the flag stay off. */ }
            if (!cancelled) setRemote({ baseUrl, enabled });
        })();
        return () => { cancelled = true; };
    }, [baseUrl]);
    return baseUrl ? remote?.baseUrl === baseUrl && remote.enabled : localEnabled;
}
