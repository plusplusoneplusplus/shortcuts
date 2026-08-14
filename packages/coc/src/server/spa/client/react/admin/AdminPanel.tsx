/**
 * AdminPanel — full admin page replacing vanilla admin.ts.
 * Config sections, operational tools, storage actions, and diagnostics.
 *
 * Visuals are driven by `admin-redesign.css` (a Linear-inspired CSS layer
 * scoped under `.admin-redesign`).
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { useApp } from '../contexts/AppContext';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import { isDesktopShell } from '../hooks/ui/useDesktopShell';
import { useLinkHandlers } from '../hooks/useLinkHandlers';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';
import type { AdminSubTab, DashboardTab } from '../types/dashboard';
import { Spinner, ToastContainer, useToast } from '../ui';
import { getLinkHandlersMeta } from '../utils/link-handler';
import { patchGlobalPreferences } from '../utils/preferencesApi';
import { FeatureTip } from '../welcome/FeatureTip';
import './admin-redesign.css';
import { DbBrowserSection } from './DbBrowserSection';
import { PromptsPanel } from './PromptsPanel';
import { ProviderTokensSection } from './ProviderTokensSection';
import { SettingsCard } from './SettingsCard';
import { AdminRow, AdminToggle, SourceBadge } from './adminControls';
import { DockedStatusFooter } from '../layout/DockedStatusFooter';

import { isContainerMode, isServersEnabled } from '../utils/config';
import { AIProviderPage } from './AIProviderPage';
import {
    ALL_TOOL_NAV_ITEMS,
    DEFAULT_SETTINGS_SUBTAB,
    SETTINGS_SUBTABS,
    TOOL_NAV_LOOKUP,
    TOOL_TAB_GROUP_LABELS,
    buildAdminNavGroups,
    deriveActiveNav,
    parseSettingsSubTabFromHash,
    type AdminNavItem,
    type SettingsSubTab,
} from './adminNavigation';
import { useAdminFeatureSettings } from './useAdminFeatureSettings';
import { FeatureSettingsCard } from './FeatureSettingsCard';
import { useAdminConfigForm } from './useAdminConfigForm';
import { useAdminPreferencesForm } from './useAdminPreferencesForm';
import { AiExecutionCard, AppearanceCard, ChatExperienceCard } from './configSettingsCards';
import { useAdminProviderSettings } from './useAdminProviderSettings';
import { useDreamsAdminConfig } from './useDreamsAdminConfig';
import { useServerRuntime } from './useServerRuntime';
import { DataOperationsPanel } from './DataOperationsPanel';
import { ServerRuntimePanel } from './ServerRuntimePanel';

// Re-exported so existing consumers (e.g. AdminPanel.nav.test) keep importing
// the navigation constants from the admin shell. Pure policy now lives in
// `./adminNavigation`.
export { ALL_TOOL_NAV_ITEMS, TOOL_TAB_GROUP_LABELS };

const AgentManagementPanel = lazy(() => import('../repos/AgentManagementPanel').then(m => ({ default: m.AgentManagementPanel })));
const IMSettingsSection = lazy(() => import('./IMSettingsSection').then(m => ({ default: m.IMSettingsSection })));

// Tool views embedded in the admin right panel. Keeping the imports here
// (not in Router.tsx) means the admin shell owns their layout.
const SkillsView = lazy(() => import('../features/skills/SkillsView').then(m => ({ default: m.SkillsView })));
const LogsView = lazy(() => import('../features/logs/LogsView').then(m => ({ default: m.LogsView })));
const UsageStatsView = lazy(() => import('../features/stats/UsageStatsView').then(m => ({ default: m.UsageStatsView })));
const ServersView = lazy(() => import('../features/servers/ServersView').then(m => ({ default: m.ServersView })));
const MemoryV2Panel = lazy(() => import('../features/memory/MemoryV2Panel').then(m => ({ default: m.MemoryV2Panel })));
const ProviderModelsSection = lazy(() => import('../features/models/ProviderModelsSection').then(m => ({ default: m.ProviderModelsSection })));
const DreamsView = lazy(() => import('../features/dreams/DreamsView').then(m => ({ default: m.DreamsView })));

interface Stats {
    processCount: number | null;
    wikiCount: number | null;
    totalBytes: number | null;
}

const WELCOME_RESET_PROGRESS = { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false };

export function AdminPanel() {
    const { toasts, addToast, removeToast } = useToast();
    const { state, dispatch } = useApp();
    const { updateOnboarding } = useOnboardingPreferences();
    const activeTab = state.activeAdminSubTab;
    // Settings sub-tab (only meaningful when activeTab === 'settings'). The
    // initial value is derived from the URL so refreshing on
    // `#admin/settings/<sub>` lands on the same section.
    const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>(() => {
        if (typeof window === 'undefined') return DEFAULT_SETTINGS_SUBTAB;
        return parseSettingsSubTabFromHash(window.location.hash) ?? DEFAULT_SETTINGS_SUBTAB;
    });
    // `state.activeTab` is the dashboard-level route. When set to a tool
    // route (skills/logs/stats/models/servers) the right panel hosts the
    // corresponding view embedded inside the admin shell.
    const activeDashboardTab = state.activeTab;
    const activeToolItem = TOOL_NAV_LOOKUP.get(activeDashboardTab) ?? null;
    const isToolEmbedded = activeToolItem !== null;
    const handleTabChange = useCallback((tab: AdminSubTab) => {
        dispatch({ type: 'SET_ADMIN_SUB_TAB', tab });
        // Admin rows always land on the admin shell — make sure the dashboard
        // tab leaves any embedded tool view.
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'admin' });
        const suffix = tab === 'settings' && settingsSubTab !== DEFAULT_SETTINGS_SUBTAB
            ? `admin/${tab}/${settingsSubTab}`
            : `admin/${tab}`;
        window.location.hash = suffix;
    }, [dispatch, settingsSubTab]);
    const handleSettingsSubTabChange = useCallback((sub: SettingsSubTab) => {
        dispatch({ type: 'SET_ADMIN_SUB_TAB', tab: 'settings' });
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'admin' });
        setSettingsSubTab(sub);
        const suffix = sub === DEFAULT_SETTINGS_SUBTAB ? 'admin/settings' : `admin/settings/${sub}`;
        window.location.hash = suffix;
    }, [dispatch]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onHash = () => {
            const parsed = parseSettingsSubTabFromHash(window.location.hash);
            if (parsed) setSettingsSubTab(parsed);
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    useEffect(() => {
        if (!state.onboardingProgress?.settingsVisited) {
            void updateOnboarding({ settingsVisited: true }).catch(() => { });
        }
    }, []);

    // Storage stats
    const [stats, setStats] = useState<Stats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    // Config
    const [config, setConfig] = useState<any>(null);
    const [configLoading, setConfigLoading] = useState(true);
    const [configError, setConfigError] = useState<string | null>(null);

    // AI & Execution + Chat Experience cards — form values, validation, dirty
    // state, and updateConfig payloads live in the controller hook.
    const configFormCtl = useAdminConfigForm({ addToast });

    // Appearance & Navigation card — global preferences + the two config-backed
    // display values (task-card density, history grouping).
    const prefsCtl = useAdminPreferencesForm({ addToast });

    // Server name
    // Workspace Features card — registry-driven values, live search, dirty
    // state, runtime-config patching, and the Ctrl/Cmd+S save shortcut all live
    // in the controller hook.
    const features = useAdminFeatureSettings({
        addToast,
        searchActive: settingsSubTab === 'features',
        shortcutActive: activeTab === 'settings' && settingsSubTab === 'features' && !isToolEmbedded,
    });
    // AI Provider page (non-container Agents tab) — default provider, enable
    // flags, Auto routing, availability, SDK install polling, and quotas.
    const providers = useAdminProviderSettings({
        addToast,
        quotaActive: activeTab === 'agents' && !isContainerMode(),
    });
    // Dreams tab config + provider activity (Knowledge nav group). Loaded with
    // the rest of the admin config; edited + saved from the Dreams tab.
    const dreams = useDreamsAdminConfig({
        addToast,
        activityActive: activeDashboardTab === 'dreams-admin' && !isContainerMode(),
    });

    // Link handlers — shared module-level state via hook
    const [linkHandlersConfig, setHandlerEnabled] = useLinkHandlers();

    // Restart is broken inside the Electron desktop shell: the server exits with
    // code 75 expecting an external supervisor to re-fork it, but coc-desktop has
    // no such supervisor, so the server never comes back. Hide the restart
    // controls there until a desktop-side supervisor is wired up. The plumbing
    // (handleRestart / admin.restart) stays intact for the web/CLI-served path.
    const isDesktop = isDesktopShell();

    // Version info
    const [versionInfo, setVersionInfo] = useState<{ version: string; commit: string } | null>(null);

    // Relaunch welcome
    const [relaunchingWelcome, setRelaunchingWelcome] = useState(false);

    // Sync settings (Integrations sub-tab)
    const [syncGitRemote, setSyncGitRemote] = useState('');
    const [syncIntervalMinutes, setSyncIntervalMinutes] = useState('5');
    const [syncSnapshot, setSyncSnapshot] = useState({ gitRemote: '', intervalMinutes: '5' });

    const loadStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const data = await getSpaCocClient().admin.getDataStats({ includeWikis: true });
            setStats({
                processCount: data.processCount ?? data.processes ?? null,
                wikiCount: data.wikiCount ?? data.wikis ?? null,
                totalBytes: data.totalBytes ?? data.diskUsage ?? null,
            });
        } catch {
            setStats(null);
        } finally {
            setStatsLoading(false);
        }
    }, []);

    const loadConfig = useCallback(async () => {
        setConfigLoading(true);
        setConfigError(null);
        try {
            const data = await getSpaCocClient().admin.getConfig();
            setConfig(data);
            const resolved = data.resolved ?? {};
            configFormCtl.hydrate(resolved);
            prefsCtl.hydrateFromConfig(resolved);
            features.hydrate(resolved);
            dreams.hydrate(resolved);
            providers.hydrate(resolved);
            const sgr = resolved.sync?.gitRemote ?? '';
            const sim = String(resolved.sync?.intervalMinutes ?? 5);
            setSyncGitRemote(sgr);
            setSyncIntervalMinutes(sim);
            setSyncSnapshot({ gitRemote: sgr, intervalMinutes: sim });
        } catch (err: unknown) {
            const detail = getSpaCocClientErrorMessage(err, '');
            setConfigError(detail ? `Failed to load configuration: ${detail}` : 'Failed to load configuration');
        } finally {
            setConfigLoading(false);
        }
    }, [configFormCtl.hydrate, prefsCtl.hydrateFromConfig, features.hydrate, dreams.hydrate, providers.hydrate]);

    const loadPreferences = useCallback(async () => {
        try {
            const data = await getSpaCocClient().preferences.getGlobal();
            prefsCtl.hydrateFromPreferences(data);
        } catch { /* ignore */ }
    }, [prefsCtl.hydrateFromPreferences]);

    // Server display-name + lifecycle (rebuild/restart). Restart state is shared
    // with the sidebar restart button, so it lives in this hook rather than the
    // Server tab panel. Save reloads config to reflect the change.
    const serverRuntime = useServerRuntime({ addToast, reloadConfig: loadConfig });

    useEffect(() => {
        loadStats();
        loadConfig();
        loadPreferences();
        getSpaCocClient().admin.getVersion()
            .then(data => { if (data) setVersionInfo(data); })
            .catch(() => { });
    }, [loadStats, loadConfig, loadPreferences]);

    // Hydrate the server display-name field whenever the config (re)loads.
    useEffect(() => {
        serverRuntime.setServerName(config?.resolved?.serve?.serverName ?? '');
    }, [config, serverRuntime.setServerName]);

    const handleRelaunchWelcome = useCallback(async () => {
        setRelaunchingWelcome(true);
        try {
            await patchGlobalPreferences({
                hasSeenWelcome: false,
                onboardingProgress: WELCOME_RESET_PROGRESS,
                dismissedTips: [],
            });
            dispatch({
                type: 'SET_WELCOME_PREFERENCES',
                payload: {
                    hasSeenWelcome: false,
                    onboardingProgress: WELCOME_RESET_PROGRESS,
                    dismissedTips: [],
                },
            });
            addToast('Welcome tour will appear on next page load', 'success');
        } catch (err: any) {
            addToast(err.message || 'Failed to reset welcome tour', 'error');
        } finally {
            setRelaunchingWelcome(false);
        }
    }, [addToast, dispatch]);

    const sources: Record<string, string> = config?.sources ?? {};
    const resolved = config?.resolved ?? {};
    const defaults: Record<string, unknown> = config?.defaults ?? {};

    const isDefaultValue = useCallback((key: string): boolean | undefined => {
        if (!config?.defaults) return undefined;
        const current = resolveNestedValue(resolved, key);
        const def = defaults[key];
        return current === def;
    }, [config?.defaults, resolved, defaults]);

    const handleToolNavClick = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        window.location.hash = '#' + tab;
    }, [dispatch]);

    // Sidebar nav groups are pure policy — container mode and the runtime
    // `serversEnabled` gate are passed as explicit inputs (see adminNavigation).
    const navGroups = buildAdminNavGroups({ isContainer: isContainerMode(), serversEnabled: isServersEnabled() });

    const handleNavItemClick = useCallback((item: AdminNavItem) => {
        switch (item.action.kind) {
            case 'settings':
                handleSettingsSubTabChange(item.action.subTab);
                return;
            case 'admin':
                handleTabChange(item.action.tab);
                return;
            case 'tool':
                handleToolNavClick(item.action.tab);
                return;
        }
    }, [handleSettingsSubTabChange, handleTabChange, handleToolNavClick]);

    const handleNavSelectChange = (key: string) => {
        const item = navGroups.flatMap(group => group.items).find(candidate => candidate.key === key);
        if (item) {
            handleNavItemClick(item);
        }
    };

    const { activeNavKey, activeTabLabel, activeBreadcrumbGroup, activePageDescription } = deriveActiveNav({
        isContainer: isContainerMode(),
        isToolEmbedded,
        activeDashboardTab,
        activeTab,
        settingsSubTab,
    });

    return (
        // Bounded, non-scrolling outer container: `.admin-redesign` fills the
        // dialog body and clips, so only `.ar-main` scrolls.
        <div id="view-admin" className="admin-redesign" data-testid="admin-scroll-container">
            <div id="admin-page-content" className="ar-shell">
                {/* ── Sidebar ── */}
                <aside className="ar-sidebar" aria-label="Admin sections">
                    <div className="ar-sidebar-head">
                        <div className="ar-brand">
                            <div className="ar-brand-logo" aria-hidden="true" />
                            <div className="ar-brand-text">
                                <span className="ar-brand-name">CoC Admin</span>
                                <span className="ar-brand-sub">{versionInfo?.version ? `v${versionInfo.version}` : 'Local server'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="ar-sidebar-nav">
                        {navGroups.map(group => (
                            <nav key={group.label} className="ar-nav-group" aria-label={group.label}>
                                <div className="ar-nav-group-label">{group.label}</div>
                                {group.items.map(item => {
                                    const isActive = activeNavKey === item.key;
                                    const isTool = item.action.kind === 'tool';
                                    return (
                                        <button
                                            key={item.key}
                                            id={isTool ? item.testId : undefined}
                                            type="button"
                                            className={`ar-nav-item${isActive ? ' is-active' : ''}`}
                                            onClick={() => handleNavItemClick(item)}
                                            data-testid={item.testId}
                                            data-tab={isTool ? item.action.tab : undefined}
                                            aria-label={item.label}
                                            aria-current={isActive ? 'page' : undefined}
                                            title={item.label}
                                        >
                                            <span className="ar-nav-icon" aria-hidden="true">{item.icon}</span>
                                            <span className="ar-nav-label">{item.label}</span>
                                        </button>
                                    );
                                })}
                            </nav>
                        ))}
                    </div>

                    <div className="ar-sidebar-foot">
                        {/* Hidden in the Electron desktop shell: exit-75 restart has no
                            supervisor there, so clicking it kills the server for good. */}
                        {!isDesktop && (
                            <button
                                type="button"
                                className="ar-sidebar-restart"
                                onClick={serverRuntime.handleRestart}
                                disabled={serverRuntime.restarting}
                                data-testid="sidebar-restart-btn"
                                title={serverRuntime.restarting ? serverRuntime.restartStatus : 'Rebuild & restart the CoC server'}
                            >
                                {serverRuntime.restarting ? <><Spinner size="sm" /> Restarting…</> : '↻ Restart Server'}
                            </button>
                        )}
                    </div>

                    {/* Remote-first shell: dock the status/action cluster in the
                        admin sidebar's own footer so it lives in the left column
                        (like the chat view) instead of the app-wide bottom band.
                        No-ops in classic / mobile, where the topbar keeps it. */}
                    <DockedStatusFooter />
                </aside>

                {/* ── Main pane ── */}
                <main className={`ar-main${isToolEmbedded ? ' ar-main--embed' : ''}`}>
                    <header className="ar-topbar">
                        <nav className="ar-breadcrumb" aria-label="Breadcrumb">
                            {isToolEmbedded && activeToolItem ? (
                                <>
                                    <span className="ar-crumb">{activeBreadcrumbGroup}</span>
                                    <span className="ar-crumb-sep">/</span>
                                    <span className="ar-crumb-now">{activeToolItem.label}</span>
                                </>
                            ) : (
                                <>
                                    <span className="ar-crumb">{activeBreadcrumbGroup}</span>
                                    <span className="ar-crumb-sep">/</span>
                                    <span className="ar-crumb-now">{activeTabLabel}</span>
                                </>
                            )}
                        </nav>
                        <select
                            className="ar-tab-select ar-mobile-tab-select"
                            value={activeNavKey}
                            onChange={e => handleNavSelectChange(e.target.value)}
                            aria-label="Select admin section"
                        >
                            {navGroups.map(group => (
                                <optgroup key={group.label} label={group.label}>
                                    {group.items.map(item => (
                                        <option key={item.key} value={item.key}>{item.label}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </header>

                    {isToolEmbedded && activeToolItem ? (
                        <div className="ar-tool-embed" data-testid={`admin-tool-embed-${activeToolItem.tab}`}>
                            <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                                {activeToolItem.tab === 'memory' && <MemoryV2Panel
                                    initialScopeId={state.activeMemoryScopeId}
                                    initialTab={state.activeMemorySubTab}
                                    onInitialScopeConsumed={() => {
                                        if (state.activeMemoryScopeId !== null) {
                                            dispatch({ type: 'SET_MEMORY_SCOPE', scopeId: null });
                                        }
                                    }}
                                />}
                                {activeToolItem.tab === 'skills' && <SkillsView />}
                                {activeToolItem.tab === 'dreams-admin' && <DreamsView
                                    config={dreams.dreamsForm}
                                    onConfigChange={patch => dreams.setDreamsForm(prev => ({ ...prev, ...patch }))}
                                    configDirty={dreams.dreamsDirty}
                                    configSaving={dreams.dreamsSaving}
                                    onSaveConfig={dreams.handleSaveDreams}
                                    onCancelConfig={dreams.handleCancelDreams}
                                    providerActivity={dreams.dreamProviderActivity}
                                    providerActivityError={dreams.dreamProviderActivityError}
                                    onRefreshProviderActivity={dreams.refreshDreamProviderActivity}
                                />}
                                {activeToolItem.tab === 'logs' && <LogsView />}
                                {activeToolItem.tab === 'stats' && <UsageStatsView />}
                                {activeToolItem.tab === 'servers' && <ServersView />}
                            </Suspense>
                        </div>
                    ) : (
                        <div className="ar-page">
                            {activePageDescription && (
                                <header className="ar-page-header">
                                    <div className="ar-page-header-row">
                                        <div>
                                            <p className="ar-page-desc">{activePageDescription}</p>
                                        </div>
                                    </div>
                                </header>
                            )}

                            <FeatureTip tipId="admin-intro" />

                            {/* ── Settings tab ── */}
                            {activeTab === 'settings' && (
                                <div className="space-y-3" data-testid="settings-cards">
                                    {/* Sub-tab bar — shown for the main settings sections (not advanced) */}
                                    {settingsSubTab !== 'advanced' && (
                                        <nav className="ar-subtab-row" role="tablist" aria-label="Settings sections">
                                            {SETTINGS_SUBTABS.filter(t => t.id !== 'advanced').map(tab => (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    role="tab"
                                                    className={`ar-subtab${(!isToolEmbedded && settingsSubTab === tab.id) ? ' is-active' : ''}`}
                                                    onClick={() => handleSettingsSubTabChange(tab.id)}
                                                    data-testid={`settings-subtab-${tab.id}`}
                                                    aria-selected={!isToolEmbedded && settingsSubTab === tab.id}
                                                >
                                                    <span className="ar-subtab-icon">{tab.icon}</span>
                                                    {tab.label}
                                                </button>
                                            ))}
                                        </nav>
                                    )}
                                    {configLoading ? (
                                        <section className="ar-card">
                                            <div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>
                                        </section>
                                    ) : configError ? (
                                        <section className="ar-card">
                                            <div data-testid="admin-config-error" className="ar-section" style={{ color: 'var(--ar-danger)' }}>{configError}</div>
                                        </section>
                                    ) : (
                                        <>
                                            {/* ── AI & Execution ── */}
                                            {settingsSubTab === 'ai' && (
                                                <AiExecutionCard
                                                    configForm={configFormCtl.configForm}
                                                    setConfigForm={configFormCtl.setConfigForm}
                                                    dirty={configFormCtl.aiExecDirty}
                                                    saving={configFormCtl.aiExecSaving}
                                                    onSave={configFormCtl.handleSaveAiExec}
                                                    onCancel={configFormCtl.handleCancelAiExec}
                                                    sources={sources}
                                                    isDefaultValue={isDefaultValue}
                                                />
                                            )}

                                            {/* ── Chat Experience ── */}
                                            {settingsSubTab === 'chat' && (
                                                <ChatExperienceCard
                                                    chatFollowUpEnabled={configFormCtl.chatFollowUpEnabled}
                                                    setChatFollowUpEnabled={configFormCtl.setChatFollowUpEnabled}
                                                    chatFollowUpCount={configFormCtl.chatFollowUpCount}
                                                    setChatFollowUpCount={configFormCtl.setChatFollowUpCount}
                                                    chatAskUserEnabled={configFormCtl.chatAskUserEnabled}
                                                    setChatAskUserEnabled={configFormCtl.setChatAskUserEnabled}
                                                    showReportIntent={configFormCtl.showReportIntent}
                                                    setShowReportIntent={configFormCtl.setShowReportIntent}
                                                    toolCompactness={configFormCtl.toolCompactness}
                                                    setToolCompactness={configFormCtl.setToolCompactness}
                                                    dirty={configFormCtl.chatDirty}
                                                    saving={configFormCtl.chatSaving}
                                                    onSave={configFormCtl.handleSaveChat}
                                                    onCancel={configFormCtl.handleCancelChat}
                                                    sources={sources}
                                                    isDefaultValue={isDefaultValue}
                                                />
                                            )}

                                            {/* ── Appearance & Navigation ── */}
                                            {settingsSubTab === 'appearance' && (
                                                <AppearanceCard
                                                    theme={prefsCtl.theme}
                                                    setTheme={prefsCtl.setTheme}
                                                    uiLayoutMode={prefsCtl.uiLayoutMode}
                                                    setUiLayoutMode={prefsCtl.setUiLayoutMode}
                                                    reposSidebarCollapsed={prefsCtl.reposSidebarCollapsed}
                                                    setReposSidebarCollapsed={prefsCtl.setReposSidebarCollapsed}
                                                    htmlEmbedEnabled={prefsCtl.htmlEmbedEnabled}
                                                    setHtmlEmbedEnabled={prefsCtl.setHtmlEmbedEnabled}
                                                    promptAutocompleteEnabled={prefsCtl.promptAutocompleteEnabled}
                                                    setPromptAutocompleteEnabled={prefsCtl.setPromptAutocompleteEnabled}
                                                    promptAutocompleteAiEnabled={prefsCtl.promptAutocompleteAiEnabled}
                                                    setPromptAutocompleteAiEnabled={prefsCtl.setPromptAutocompleteAiEnabled}
                                                    taskCardDensity={prefsCtl.taskCardDensity}
                                                    setTaskCardDensity={prefsCtl.setTaskCardDensity}
                                                    historyGrouping={prefsCtl.historyGrouping}
                                                    setHistoryGrouping={prefsCtl.setHistoryGrouping}
                                                    dirty={prefsCtl.appearanceDirty}
                                                    saving={prefsCtl.appearanceSaving}
                                                    onSave={prefsCtl.handleSaveAppearance}
                                                    onCancel={prefsCtl.handleCancelAppearance}
                                                    sources={sources}
                                                    isDefaultValue={isDefaultValue}
                                                />
                                            )}

                                            {/* ── Workspace Features ── */}
                                            {settingsSubTab === 'features' && (
                                                <FeatureSettingsCard
                                                    featureValues={features.featureValues}
                                                    setFeatureValues={features.setFeatureValues}
                                                    featureSearch={features.featureSearch}
                                                    setFeatureSearch={features.setFeatureSearch}
                                                    dirty={features.featuresDirty}
                                                    saving={features.featuresSaving}
                                                    onSave={features.handleSaveFeatures}
                                                    onCancel={features.handleCancelFeatures}
                                                    sources={sources}
                                                    isDefaultValue={isDefaultValue}
                                                />
                                            )}

                                            {/* ── Link Handlers (Integrations) ── */}
                                            {settingsSubTab === 'integrations' && (
                                                <SettingsCard
                                                    title="Link handlers"
                                                    badge="Global"
                                                    description="Open specific URLs in desktop apps instead of a browser tab. Requires the desktop app to be installed."
                                                    data-testid="settings-link-handlers"
                                                >
                                                    {getLinkHandlersMeta().map(meta => (
                                                        <AdminRow key={meta.name} name={meta.label} hint={meta.description}>
                                                            <AdminToggle
                                                                checked={linkHandlersConfig[meta.name] === true}
                                                                onChange={checked => setHandlerEnabled(meta.name, checked)}
                                                                data-testid={`toggle-link-handler-${meta.name}`}
                                                            />
                                                        </AdminRow>
                                                    ))}
                                                </SettingsCard>
                                            )}

                                            {/* ── Providers (credentials) ── */}
                                            {settingsSubTab === 'providers' && (
                                                <section className="ar-card" data-testid="settings-providers">
                                                    <div style={{ padding: 4 }}>
                                                        <ProviderTokensSection
                                                            onError={msg => addToast(msg, 'error')}
                                                            onSuccess={msg => addToast(msg, 'success')}
                                                        />
                                                    </div>
                                                </section>
                                            )}

                                            {/* ── Advanced & Recovery ── */}
                                            {settingsSubTab === 'advanced' && (
                                                <SettingsCard
                                                    title="Advanced & Recovery"
                                                    badge="Advanced"
                                                    description="Read-only diagnostics and recovery actions."
                                                    data-testid="settings-advanced"
                                                >
                                                    <AdminRow name="Approve Permissions" hint={<>Resolved value from your environment.</>}>
                                                        <span className="ar-mono ar-muted" style={{ fontSize: 12.5 }}>{String(resolved.approvePermissions ?? '—')}</span>
                                                        <SourceBadge source={sources['approvePermissions']} isDefault={isDefaultValue('approvePermissions')} />
                                                    </AdminRow>
                                                    <AdminRow name="MCP Config" hint="Path to the MCP servers config loaded at startup.">
                                                        <span className="ar-mono ar-muted" style={{ fontSize: 12.5 }}>{String(resolved.mcpConfig ?? '—')}</span>
                                                        <SourceBadge source={sources['mcpConfig']} isDefault={isDefaultValue('mcpConfig')} />
                                                    </AdminRow>
                                                    <AdminRow name="Persist" hint="Whether sessions are persisted to disk.">
                                                        <span className="ar-mono ar-muted" style={{ fontSize: 12.5 }}>{String(resolved.persist ?? '—')}</span>
                                                        <SourceBadge source={sources['persist']} isDefault={isDefaultValue('persist')} />
                                                    </AdminRow>
                                                    {SHOW_WELCOME_TUTORIAL && (
                                                        <AdminRow
                                                            name="Welcome Tour"
                                                            hint="Re-show the welcome modal and reset onboarding progress."
                                                        >
                                                            <button
                                                                type="button"
                                                                className="ar-btn ar-btn-secondary ar-btn-sm"
                                                                onClick={handleRelaunchWelcome}
                                                                disabled={relaunchingWelcome}
                                                                data-testid="relaunch-welcome-btn"
                                                            >
                                                                {relaunchingWelcome && <Spinner size="sm" />}
                                                                Relaunch Welcome Tour
                                                            </button>
                                                        </AdminRow>
                                                    )}
                                                </SettingsCard>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* ── Data tab ── */}
                            {activeTab === 'data' && (
                                <DataOperationsPanel addToast={addToast} onDataChanged={loadStats} />
                            )}

                            {/* ── Server tab ── */}
                            {activeTab === 'server' && (
                                <ServerRuntimePanel
                                    config={config}
                                    resolved={resolved}
                                    versionInfo={versionInfo}
                                    isContainer={isContainerMode()}
                                    isDesktop={isDesktop}
                                    sources={sources}
                                    isDefaultValue={isDefaultValue}
                                    addToast={addToast}
                                    serverName={serverRuntime.serverName}
                                    setServerName={serverRuntime.setServerName}
                                    handleSaveServerName={serverRuntime.handleSaveServerName}
                                    restarting={serverRuntime.restarting}
                                    restartStatus={serverRuntime.restartStatus}
                                    handleRestart={serverRuntime.handleRestart}
                                />
                            )}

                            {/* ── Prompts tab ── */}
                            {activeTab === 'prompts' && (
                                <section className="ar-card">
                                    <div style={{ padding: 16 }}>
                                        <PromptsPanel onError={msg => addToast(msg, 'error')} />
                                    </div>
                                </section>
                            )}

                            {activeTab === 'database' && (
                                <section className="ar-card">
                                    <div style={{ padding: 16 }}>
                                        <DbBrowserSection />
                                    </div>
                                </section>
                            )}

                            {activeTab === 'agents' && isContainerMode() && (
                                <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                                    <AgentManagementPanel />
                                </Suspense>
                            )}

                            {activeTab === 'agents' && !isContainerMode() && (
                                <AIProviderPage
                                    defaultProvider={providers.defaultProvider}
                                    setDefaultProvider={providers.setDefaultProvider}
                                    codexEnabled={providers.codexEnabled}
                                    setCodexEnabled={providers.setCodexEnabled}
                                    claudeEnabled={providers.claudeEnabled}
                                    setClaudeEnabled={providers.setClaudeEnabled}
                                    opencodeEnabled={providers.opencodeEnabled}
                                    setOpencodeEnabled={providers.setOpencodeEnabled}
                                    autoAgentProviderRoutingEnabled={providers.autoAgentProviderRoutingEnabled}
                                    setAutoAgentProviderRoutingEnabled={providers.setAutoAgentProviderRoutingEnabled}
                                    autoRoutingConfig={providers.autoRoutingConfig}
                                    setAutoRoutingConfig={providers.setAutoRoutingConfig}
                                    providerAvailability={providers.providerAvailability}
                                    sdkInstallStatuses={providers.sdkInstallStatuses}
                                    sdkInstallErrors={providers.sdkInstallErrors}
                                    onInstallSdk={providers.handleInstallSdk}
                                    dirty={providers.defaultProviderDirty}
                                    saving={providers.defaultProviderSaving}
                                    onSave={providers.handleSaveDefaultProvider}
                                    onCancel={providers.handleCancelDefaultProvider}
                                    quotaData={providers.quotaData}
                                    quotaLoading={providers.quotaLoading}
                                    quotaError={providers.quotaError}
                                    onRefreshQuota={providers.handleRefreshQuota}
                                    sources={sources}
                                />
                            )}

                            {activeTab === 'messaging' && isContainerMode() && (
                                <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                                    <IMSettingsSection />
                                </Suspense>
                            )}
                        </div>
                    )}
                </main>

                <ToastContainer toasts={toasts} removeToast={removeToast} />
            </div>
        </div>
    );
}

/** Resolve a dot-notation key against a nested object (e.g. "notes.enabled" -> resolved.notes.enabled). */
function resolveNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const segments = key.split('.');
    let current: unknown = obj;
    for (const seg of segments) {
        if (typeof current !== 'object' || current === null) return undefined;
        current = (current as Record<string, unknown>)[seg];
    }
    return current;
}
