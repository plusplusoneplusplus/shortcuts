import { useEffect, useState } from 'react';
import { normalizeApiBasePath } from '@plusplusoneplusplus/coc-client';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isChatProviderSwitchingEnabled } from '../../utils/config';

const remoteFlagCache = new Map<string, boolean>();

function remoteRuntimeConfigUrl(baseUrl: string): string {
    const apiBasePath = (globalThis as { window?: { __DASHBOARD_CONFIG__?: { apiBasePath?: string } } })
        .window?.__DASHBOARD_CONFIG__?.apiBasePath;
    return `${baseUrl.replace(/\/+$/, '')}${normalizeApiBasePath(apiBasePath)}/config/runtime`;
}

/** Test seam: drop cached target-server capabilities between cases. */
export function __resetChatProviderSwitchingFlagCache(): void {
    remoteFlagCache.clear();
}

/**
 * Reads provider-switching support from the server that owns the conversation.
 * Missing flags, failed probes, and in-flight remote probes are unsupported.
 */
export function useChatProviderSwitchingEnabled(baseUrl?: string): boolean {
    const [localEnabled, setLocalEnabled] = useState(isChatProviderSwitchingEnabled());
    const [remoteEnabled, setRemoteEnabled] = useState<boolean | undefined>(
        baseUrl ? remoteFlagCache.get(baseUrl) : undefined,
    );

    useEffect(() => {
        const onConfigUpdated = () => setLocalEnabled(isChatProviderSwitchingEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);

    useEffect(() => {
        if (!baseUrl) {
            setRemoteEnabled(undefined);
            return;
        }
        const cached = remoteFlagCache.get(baseUrl);
        if (cached !== undefined) {
            setRemoteEnabled(cached);
            return;
        }
        let cancelled = false;
        setRemoteEnabled(undefined);
        void (async () => {
            let flag = false;
            try {
                const response = await fetch(remoteRuntimeConfigUrl(baseUrl));
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                flag = data?.features?.chatProviderSwitchingEnabled === true;
            } catch {
                flag = false;
            }
            remoteFlagCache.set(baseUrl, flag);
            if (!cancelled) setRemoteEnabled(flag);
        })();
        return () => { cancelled = true; };
    }, [baseUrl]);

    return baseUrl ? remoteEnabled === true : localEnabled;
}
