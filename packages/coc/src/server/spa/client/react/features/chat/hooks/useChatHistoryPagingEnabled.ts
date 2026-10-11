import { useEffect, useState } from 'react';
import { normalizeApiBasePath } from '@plusplusoneplusplus/coc-client';
import * as config from '../../../utils/config';

function localEnabled(): boolean {
    return 'isFeatureEnabled' in config && config.isFeatureEnabled?.('chatHistoryPagingEnabled') === true;
}

/** Capabilities belong to the conversation's server, never the page origin. */
export function useChatHistoryPagingEnabled(baseUrl?: string, available = true, selectionKey = ''): boolean | null {
    const [local, setLocal] = useState(localEnabled);
    const [remote, setRemote] = useState<{ baseUrl: string; selectionKey: string; enabled: boolean } | null>(null);
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const update = () => {
            setLocal(localEnabled());
            setVersion(v => v + 1);
        };
        const remoteUpdate = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.baseUrl === baseUrl && (detail?.message ?? detail?.data)?.type === 'config-changed') update();
        };
        const reconnect = (event: Event) => {
            if ((event as CustomEvent).detail?.baseUrl === baseUrl) update();
        };
        window.addEventListener(config.DASHBOARD_CONFIG_UPDATED_EVENT, update);
        window.addEventListener('coc-remote-ws-message', remoteUpdate);
        window.addEventListener('coc-remote-ws-connect', reconnect);
        return () => {
            window.removeEventListener(config.DASHBOARD_CONFIG_UPDATED_EVENT, update);
            window.removeEventListener('coc-remote-ws-message', remoteUpdate);
            window.removeEventListener('coc-remote-ws-connect', reconnect);
        };
    }, [baseUrl]);
    useEffect(() => {
        if (!baseUrl || !available) return;
        const controller = new AbortController();
        const apiBase = normalizeApiBasePath(window.__DASHBOARD_CONFIG__?.apiBasePath);
        void fetch(`${baseUrl.replace(/\/+$/, '')}${apiBase}/config/runtime`, { signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error('Capability unavailable');
                return response.json();
            })
            .then(data => {
                if (!controller.signal.aborted) setRemote({ baseUrl, selectionKey, enabled: data?.features?.chatHistoryPagingEnabled === true });
            })
            .catch(() => {
                if (!controller.signal.aborted) setRemote({ baseUrl, selectionKey, enabled: false });
            });
        return () => controller.abort();
    }, [baseUrl, available, version, selectionKey]);
    if (!available) return null;
    return baseUrl ? remote?.baseUrl === baseUrl && remote.selectionKey === selectionKey ? remote.enabled : null : local;
}
