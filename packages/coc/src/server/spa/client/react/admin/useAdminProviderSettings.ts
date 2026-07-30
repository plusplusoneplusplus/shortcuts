/**
 * useAdminProviderSettings — controller for the AI Provider page (non-container
 * Agents tab).
 *
 * Owns the default-provider selection, per-provider enable flags, Auto routing
 * config, provider availability, optional-SDK install status + polling, and the
 * provider quota snapshot. The card is pure UI (`AIProviderPage`); all state,
 * validation, and API calls live here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    AdminAutoProviderRoutingConfig,
    AdminDefaultProvider,
    AgentProvidersQuotaResponse,
    ProviderInstallStatus,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { normalizeAutoProviderRoutingConfig, type NormalizedAutoProviderRoutingConfig } from './AIProviderPage';

export type DefaultProviderSnapshot = {
    provider: AdminDefaultProvider;
    codexEnabled: boolean;
    claudeEnabled: boolean;
    opencodeEnabled: boolean;
    autoAgentProviderRouting: boolean;
    autoRoutingConfig: NormalizedAutoProviderRoutingConfig;
};

export function autoRoutingConfigsEqual(
    a: AdminAutoProviderRoutingConfig | null | undefined,
    b: AdminAutoProviderRoutingConfig | null | undefined,
): boolean {
    return JSON.stringify(normalizeAutoProviderRoutingConfig(a)) === JSON.stringify(normalizeAutoProviderRoutingConfig(b));
}

export interface UseAdminProviderSettingsOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** True while the AI Provider tab is active and the quota should auto-refresh. */
    quotaActive: boolean;
}

export function useAdminProviderSettings({ addToast, quotaActive }: UseAdminProviderSettingsOptions) {
    const [autoAgentProviderRoutingEnabled, setAutoAgentProviderRoutingEnabled] = useState(false);
    const [codexEnabled, setCodexEnabled] = useState(false);
    const [claudeEnabled, setClaudeEnabled] = useState(false);
    const [opencodeEnabled, setOpencodeEnabled] = useState(false);
    const [defaultProvider, setDefaultProvider] = useState<AdminDefaultProvider>('copilot');
    const [autoRoutingConfig, setAutoRoutingConfig] = useState<NormalizedAutoProviderRoutingConfig>(() => normalizeAutoProviderRoutingConfig(undefined));
    const [providerAvailability, setProviderAvailability] = useState<Record<string, { available: boolean; error?: string }>>({});
    const [sdkInstallStatuses, setSdkInstallStatuses] = useState<Record<string, ProviderInstallStatus>>({});
    const [sdkInstallErrors, setSdkInstallErrors] = useState<Record<string, string | undefined>>({});
    const sdkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [defaultProviderSaving, setDefaultProviderSaving] = useState(false);
    const [defaultProviderSnapshot, setDefaultProviderSnapshot] = useState<DefaultProviderSnapshot>({
        provider: 'copilot',
        codexEnabled: false,
        claudeEnabled: false,
        opencodeEnabled: false,
        autoAgentProviderRouting: false,
        autoRoutingConfig: normalizeAutoProviderRoutingConfig(undefined),
    });

    const [quotaData, setQuotaData] = useState<AgentProvidersQuotaResponse | null>(null);
    const [quotaLoading, setQuotaLoading] = useState(false);
    const [quotaError, setQuotaError] = useState<string | null>(null);

    /** Loads the provider values + dirty snapshot from a freshly-fetched resolved config. */
    const hydrate = useCallback((resolved: any) => {
        const aapre = resolved.features?.autoAgentProviderRouting ?? false;
        setAutoAgentProviderRoutingEnabled(aapre);
        const cxe = resolved.codex?.enabled ?? false;
        setCodexEnabled(cxe);
        const cle = resolved.claude?.enabled ?? false;
        setClaudeEnabled(cle);
        const oce = resolved.opencode?.enabled ?? false;
        setOpencodeEnabled(oce);
        const dp = (resolved.defaultProvider === 'codex' ? 'codex' : resolved.defaultProvider === 'claude' ? 'claude' : resolved.defaultProvider === 'opencode' ? 'opencode' : 'copilot') as AdminDefaultProvider;
        const arc = normalizeAutoProviderRoutingConfig(resolved.agentProviderRouting?.auto);
        setDefaultProvider(dp);
        setAutoRoutingConfig(arc);
        setDefaultProviderSnapshot({ provider: dp, codexEnabled: cxe, claudeEnabled: cle, opencodeEnabled: oce, autoAgentProviderRouting: aapre, autoRoutingConfig: arc });
    }, []);

    /** Refreshes install status for both optional SDK providers from the providers list. */
    const loadSdkInstallStatuses = useCallback(() => {
        getSpaCocClient().agentProviders.list()
            .then(data => {
                if (!data?.providers) return;
                const statuses: Record<string, ProviderInstallStatus> = {};
                for (const p of data.providers) {
                    if (p.installStatus) {
                        statuses[p.id] = p.installStatus;
                    }
                }
                setSdkInstallStatuses(statuses);
            })
            .catch(() => { /* non-fatal */ });
    }, []);

    // Provider availability + SDK install status load once on mount.
    useEffect(() => {
        fetch('/api/admin/providers/availability')
            .then(r => r.json())
            .then((data: Record<string, { available: boolean; error?: string }>) => setProviderAvailability(data))
            .catch(() => { });
        loadSdkInstallStatuses();
    }, [loadSdkInstallStatuses]);

    const defaultProviderDirty = defaultProvider !== defaultProviderSnapshot.provider ||
        codexEnabled !== defaultProviderSnapshot.codexEnabled ||
        claudeEnabled !== defaultProviderSnapshot.claudeEnabled ||
        opencodeEnabled !== defaultProviderSnapshot.opencodeEnabled ||
        autoAgentProviderRoutingEnabled !== defaultProviderSnapshot.autoAgentProviderRouting ||
        !autoRoutingConfigsEqual(autoRoutingConfig, defaultProviderSnapshot.autoRoutingConfig);

    const handleSaveDefaultProvider = useCallback(async () => {
        setDefaultProviderSaving(true);
        try {
            const normalizedAutoRouting = normalizeAutoProviderRoutingConfig(autoRoutingConfig);
            const payload: Record<string, unknown> = {
                defaultProvider,
                'codex.enabled': codexEnabled,
                'claude.enabled': claudeEnabled,
                'opencode.enabled': opencodeEnabled,
                'features.autoAgentProviderRouting': autoAgentProviderRoutingEnabled,
            };
            if (autoAgentProviderRoutingEnabled) {
                payload['agentProviderRouting.auto'] = normalizedAutoRouting;
            }
            await getSpaCocClient().admin.updateConfig(payload);
            addToast('AI provider settings saved — restart required to apply changes', 'success');
            setAutoRoutingConfig(normalizedAutoRouting);
            setDefaultProviderSnapshot({ provider: defaultProvider, codexEnabled, claudeEnabled, opencodeEnabled, autoAgentProviderRouting: autoAgentProviderRoutingEnabled, autoRoutingConfig: normalizedAutoRouting });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setDefaultProviderSaving(false);
        }
    }, [defaultProvider, autoAgentProviderRoutingEnabled, codexEnabled, claudeEnabled, opencodeEnabled, autoRoutingConfig, addToast]);

    const handleCancelDefaultProvider = useCallback(() => {
        setDefaultProvider(defaultProviderSnapshot.provider);
        setCodexEnabled(defaultProviderSnapshot.codexEnabled);
        setClaudeEnabled(defaultProviderSnapshot.claudeEnabled);
        setOpencodeEnabled(defaultProviderSnapshot.opencodeEnabled);
        setAutoAgentProviderRoutingEnabled(defaultProviderSnapshot.autoAgentProviderRouting);
        setAutoRoutingConfig(defaultProviderSnapshot.autoRoutingConfig);
    }, [defaultProviderSnapshot]);

    /** Starts npm install for the given optional provider (codex|claude). */
    const handleInstallSdk = useCallback(async (provider: 'codex' | 'claude') => {
        setSdkInstallStatuses(prev => ({ ...prev, [provider]: 'installing' }));
        setSdkInstallErrors(prev => ({ ...prev, [provider]: undefined }));
        try {
            await getSpaCocClient().agentProviders.installProvider(provider);
        } catch (err: unknown) {
            const msg = getSpaCocClientErrorMessage(err, 'Install request failed');
            setSdkInstallStatuses(prev => ({ ...prev, [provider]: 'install-failed' }));
            setSdkInstallErrors(prev => ({ ...prev, [provider]: msg }));
            return;
        }
        // Poll until status resolves (installed or install-failed).
        if (sdkPollRef.current) clearInterval(sdkPollRef.current);
        sdkPollRef.current = setInterval(async () => {
            try {
                const res = await getSpaCocClient().agentProviders.getProviderInstallStatus(provider);
                setSdkInstallStatuses(prev => ({ ...prev, [provider]: res.status }));
                if (res.status === 'install-failed') {
                    setSdkInstallErrors(prev => ({ ...prev, [provider]: res.error }));
                }
                if (res.status === 'installed' || res.status === 'install-failed') {
                    if (sdkPollRef.current) { clearInterval(sdkPollRef.current); sdkPollRef.current = null; }
                    // Reload providers list so the main UI reflects the change.
                    loadSdkInstallStatuses();
                }
            } catch { /* ignore transient poll errors */ }
        }, 2000);
    }, [loadSdkInstallStatuses]);

    // Stop polling when the component unmounts.
    useEffect(() => () => { if (sdkPollRef.current) clearInterval(sdkPollRef.current); }, []);

    const handleRefreshQuota = useCallback(async (options: { force?: boolean } = {}) => {
        setQuotaLoading(true);
        setQuotaError(null);
        try {
            const data = await getSpaCocClient().admin.getAgentProvidersQuota({ force: options.force });
            if (!Array.isArray(data.providers)) {
                throw new Error('Quota response missing providers');
            }
            setQuotaData(data);
        } catch (err: unknown) {
            setQuotaError(getSpaCocClientErrorMessage(err, 'Failed to fetch quota'));
        } finally {
            setQuotaLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!quotaActive) return;
        void handleRefreshQuota();
    }, [quotaActive, handleRefreshQuota]);

    return {
        defaultProvider, setDefaultProvider,
        codexEnabled, setCodexEnabled,
        claudeEnabled, setClaudeEnabled,
        opencodeEnabled, setOpencodeEnabled,
        autoAgentProviderRoutingEnabled, setAutoAgentProviderRoutingEnabled,
        autoRoutingConfig, setAutoRoutingConfig,
        providerAvailability,
        sdkInstallStatuses, sdkInstallErrors,
        handleInstallSdk,
        defaultProviderDirty, defaultProviderSaving,
        handleSaveDefaultProvider, handleCancelDefaultProvider,
        quotaData, quotaLoading, quotaError, handleRefreshQuota,
        hydrate,
    };
}

export type AdminProviderSettings = ReturnType<typeof useAdminProviderSettings>;
