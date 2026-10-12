import { useEffect, useState } from 'react';
import { useCocClient, useCloneBaseUrl } from '../../../repos/cloneRouting';
import { getWorkspaceIdFromSelectionId } from '../../../repos/cloneIdentity';
import { getSpaCocClient } from '../../../api/cocClient';
import { desktopBrowserBridge } from '../../../shared/file-path/browser-bridge';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isBrowserControlEnabled } from '../../../utils/config';
import { configCacheKey, invalidateConfig, subscribeConfigInvalidation } from '../../../api/staticConfigCache';

export function useBrowserToolEnabled(workspaceId?: string, routingRef?: string | null): boolean {
    const route = routingRef === null ? undefined : routingRef ?? workspaceId;
    const routedClient = useCocClient(route);
    const routedBaseUrl = useCloneBaseUrl(route);
    const client = routingRef === null ? getSpaCocClient() : routedClient;
    const baseUrl = routingRef === null ? undefined : routedBaseUrl;
    const rawWorkspaceId = workspaceId ? getWorkspaceIdFromSelectionId(workspaceId) : undefined;
    const owner = JSON.stringify([baseUrl, rawWorkspaceId, route, routingRef === null]);
    const [state, setState] = useState({ owner: '', enabled: false });
    const [revision, setRevision] = useState(0);
    const desktop = !!desktopBrowserBridge();
    const available = desktop && (!!baseUrl || isBrowserControlEnabled());
    useEffect(() => {
        if (!desktop || !rawWorkspaceId) return;
        const refresh = () => setRevision(value => value + 1);
        const key = configCacheKey.llmToolsConfig(rawWorkspaceId, baseUrl);
        const refreshRemote = (event: Event) => {
            const detail = (event as CustomEvent<{ baseUrl?: string; message?: { type?: string } }>).detail;
            if (baseUrl && detail?.baseUrl === baseUrl
                && (event.type === 'coc-remote-ws-connect' || detail.message?.type === 'config-changed')) invalidateConfig(key);
        };
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
        window.addEventListener('coc-remote-ws-message', refreshRemote);
        window.addEventListener('coc-remote-ws-connect', refreshRemote);
        const unsubscribe = subscribeConfigInvalidation(key, refresh);
        return () => {
            window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
            window.removeEventListener('coc-remote-ws-message', refreshRemote);
            window.removeEventListener('coc-remote-ws-connect', refreshRemote);
            unsubscribe();
        };
    }, [desktop, rawWorkspaceId, baseUrl]);
    useEffect(() => {
        setState({ owner, enabled: false });
        if (!rawWorkspaceId || !available) return;
        let disposed = false;
        client.preferences.getLlmToolsConfig(rawWorkspaceId).then(config => {
            if (!disposed) setState({ owner, enabled: config.tools.some(tool => tool.name === 'browser')
                && !config.disabledLlmTools.includes('browser') });
        }).catch(() => {
            console.warn('Browser control availability lookup failed.');
            if (!disposed) setState({ owner, enabled: false });
        });
        return () => { disposed = true; };
    }, [rawWorkspaceId, available, client, revision, owner]);
    return available && state.owner === owner && state.enabled;
}
