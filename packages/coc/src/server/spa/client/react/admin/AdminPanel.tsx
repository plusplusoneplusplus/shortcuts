/**
 * AdminPanel — full admin page replacing vanilla admin.ts.
 * Config sections, operational tools, storage actions, and diagnostics.
 *
 * Visuals are driven by `admin-redesign.css` (a Linear-inspired CSS layer
 * scoped under `.admin-redesign`).
 */

import type { AdminAutoProviderRoutingConfig, AdminDefaultProvider, ProviderInstallStatus } from '@plusplusoneplusplus/coc-client';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { useApp } from '../contexts/AppContext';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';
import { invalidateHtmlEmbedPreference } from '../hooks/preferences/useHtmlEmbedPreference';
import { useLinkHandlers } from '../hooks/useLinkHandlers';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';
import type { AdminSubTab, DashboardTab } from '../types/dashboard';
import { Spinner, ToastContainer, useToast } from '../ui';
import { getLinkHandlersMeta } from '../utils/link-handler';
import { patchGlobalPreferences } from '../utils/preferencesApi';
import { FeatureTip } from '../welcome/FeatureTip';
import { loadDreamProviderActivity, type AgentProviderWorkActivity } from '../shared/providerActivity';
import './admin-redesign.css';
import { DbBrowserSection } from './DbBrowserSection';
import { PromptsPanel } from './PromptsPanel';
import { ProviderTokensSection } from './ProviderTokensSection';
import { SettingsCard } from './SettingsCard';

import { isContainerMode, isServersEnabled } from '../utils/config';
import { AIProviderPage, normalizeAutoProviderRoutingConfig, type NormalizedAutoProviderRoutingConfig } from './AIProviderPage';
import {
    ADMIN_SETTING_DEFINITIONS,
    FEATURE_CARD_GROUPS,
    getFeatureCardSettings,
    readAdminSettingValue,
    type AdminSettingDefinition,
} from '../../../../../config/admin-setting-definitions';

const StorageSection = lazy(() => import('./StorageSection'));
const AgentManagementPanel = lazy(() => import('../repos/AgentManagementPanel').then(m => ({ default: m.AgentManagementPanel })));
const IMSettingsSection = lazy(() => import('./IMSettingsSection').then(m => ({ default: m.IMSettingsSection })));
const ContainerLinkSection = lazy(() => import('./ContainerLinkSection').then(m => ({ default: m.ContainerLinkSection })));

// Tool views embedded in the admin right panel. Keeping the imports here
// (not in Router.tsx) means the admin shell owns their layout.
const SkillsView = lazy(() => import('../features/skills/SkillsView').then(m => ({ default: m.SkillsView })));
const LogsView = lazy(() => import('../features/logs/LogsView').then(m => ({ default: m.LogsView })));
const UsageStatsView = lazy(() => import('../features/stats/UsageStatsView').then(m => ({ default: m.UsageStatsView })));
const ServersView = lazy(() => import('../features/servers/ServersView').then(m => ({ default: m.ServersView })));
const MemoryV2Panel = lazy(() => import('../features/memory/MemoryV2Panel').then(m => ({ default: m.MemoryV2Panel })));
const ProviderModelsSection = lazy(() => import('../features/models/ProviderModelsSection').then(m => ({ default: m.ProviderModelsSection })));

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

interface Stats {
    processCount: number | null;
    wikiCount: number | null;
    totalBytes: number | null;
}

const VALID_OUTPUT_OPTIONS = ['table', 'json', 'csv', 'markdown'] as const;

/**
 * Features-card state: current and last-saved values keyed by flat config key
 * (e.g. 'loops.enabled'). Rows, dirty state, and the save payload all derive
 * from the admin setting registry — adding a setting there with `ui` metadata
 * surfaces it here with no per-setting code.
 */
type FeatureValues = Record<string, boolean | string>;

const FEATURES_CARD_SETTINGS: readonly AdminSettingDefinition[] =
    ADMIN_SETTING_DEFINITIONS.filter(def => def.ui !== undefined);

function readFeatureValues(resolved: unknown): FeatureValues {
    const values: FeatureValues = {};
    for (const def of FEATURES_CARD_SETTINGS) {
        values[def.key] = readAdminSettingValue(def, resolved) as boolean | string;
    }
    return values;
}

const FEATURE_BADGES: Record<string, { className: string; label: string }> = {
    restart: { className: 'ar-badge ar-badge-warning', label: 'Restart' },
    experimental: { className: 'ar-badge ar-badge-accent', label: 'Experimental' },
    preview: { className: 'ar-badge ar-badge-accent', label: 'Preview' },
};

type DefaultProviderSnapshot = {
    provider: AdminDefaultProvider;
    codexEnabled: boolean;
    claudeEnabled: boolean;
    autoAgentProviderRouting: boolean;
    autoRoutingConfig: NormalizedAutoProviderRoutingConfig;
};

function autoRoutingConfigsEqual(
    a: AdminAutoProviderRoutingConfig | null | undefined,
    b: AdminAutoProviderRoutingConfig | null | undefined,
): boolean {
    return JSON.stringify(normalizeAutoProviderRoutingConfig(a)) === JSON.stringify(normalizeAutoProviderRoutingConfig(b));
}

const TAB_LABELS: Record<AdminSubTab, string> = {
    settings: 'AI & Execution',
    providers: 'Providers',
    data: 'Backup & Reset',
    server: 'Server',
    prompts: 'System Prompts',
    database: 'Database Browser',
    agents: isContainerMode() ? 'Agents' : 'AI Provider',
    messaging: 'Messaging',
};
const TAB_ICONS: Record<AdminSubTab, string> = {
    settings: '⚙',
    providers: '◇',
    data: '▦',
    server: '⌗',
    prompts: '✎',
    database: '◫',
    agents: isContainerMode() ? '⊞' : '◉',
    messaging: '✉',
};
const TAB_DESCRIPTIONS: Record<AdminSubTab, string> = {
    settings: 'Default model, execution limits, timeout, and output format for AI tasks.',
    providers: 'Manage credentials for GitHub, Azure DevOps, and other connected providers.',
    data: 'Storage backend, JSON import / export, and destructive cleanup actions.',
    server: 'Inspect the running CoC process, change its display name, or restart it.',
    prompts: 'Read-only view of the system prompts the assistant uses.',
    database: 'Browse the underlying SQLite tables that back CoC.',
    agents: isContainerMode() ? 'View and manage agents connected to this container.' : '',
    messaging: 'Configure container messaging integrations (e.g. WhatsApp).',
};
// ── Settings sections promoted into the sidebar. Each entry maps 1:1 to a
// `SettingsCard` further down. Selection is kept in component state and synced
// to the URL fragment so refreshes land on the same section.
type SettingsSubTab = 'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'providers' | 'advanced';
const SETTINGS_SUBTABS: { id: SettingsSubTab; label: string; icon: string }[] = [
    { id: 'ai', label: 'AI & Execution', icon: '✦' },
    { id: 'chat', label: 'Chat', icon: '◌' },
    { id: 'appearance', label: 'Appearance', icon: '◐' },
    { id: 'features', label: 'Features', icon: '◫' },
    { id: 'integrations', label: 'Integrations', icon: '⇄' },
    { id: 'providers', label: 'Providers', icon: '◇' },
    { id: 'advanced', label: 'Advanced', icon: '⚙' },
];
const DEFAULT_SETTINGS_SUBTAB: SettingsSubTab = 'ai';
const VALID_SETTINGS_SUBTABS = new Set<SettingsSubTab>(SETTINGS_SUBTABS.map(t => t.id));
const SETTINGS_SUBTAB_DESCRIPTIONS: Record<SettingsSubTab, string> = {
    ai: '',
    chat: 'Conversation behavior, follow-up suggestions, and transcript detail.',
    appearance: 'Theme, layout density, navigation, and prompt autocomplete preferences.',
    features: 'Enable or disable optional workspace and dashboard features.',
    integrations: 'Desktop link handlers and local integration preferences.',
    providers: 'Manage credentials for GitHub, Azure DevOps, and other connected providers.',
    advanced: 'Read-only diagnostics and recovery actions.',
};

function getSettingsSubTabMeta(subTab: SettingsSubTab): { id: SettingsSubTab; label: string; icon: string } {
    return SETTINGS_SUBTABS.find(t => t.id === subTab) ?? SETTINGS_SUBTABS[0];
}

function parseSettingsSubTabFromHash(hash: string): SettingsSubTab | null {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'admin' || parts[1] !== 'settings') return null;
    const candidate = parts[2] as SettingsSubTab | undefined;
    if (!candidate) return DEFAULT_SETTINGS_SUBTAB;
    return VALID_SETTINGS_SUBTABS.has(candidate) ? candidate : null;
}

const WELCOME_RESET_PROGRESS = { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false };

// ── Embedded tool routes. Each entry stays a top-level dashboard route (so
// deep links like `#skills` continue to work), but the corresponding view is
// rendered inside the admin right panel. Sidebar grouping is defined below by
// user task, not by whether the destination is a config section or a tool route.
interface ToolNavItem {
    id: string;
    tab: DashboardTab;
    label: string;
    icon: string;
    description: string;
}
export const ALL_TOOL_NAV_ITEMS: ToolNavItem[] = [
    { id: 'memory-toggle', tab: 'memory', label: 'Memory', icon: '◈', description: 'View and manage global and workspace memory facts, reviews, and episodes.' },
    { id: 'skills-toggle', tab: 'skills', label: 'Skills', icon: '⚡', description: 'Install, configure, and inspect agent skills surfaced to the assistant.' },
    { id: 'logs-toggle', tab: 'logs', label: 'Logs', icon: '📋', description: 'Live and historical server logs streamed via SSE.' },
    { id: 'stats-toggle', tab: 'stats', label: 'Usage & Costs', icon: '📊', description: 'Aggregated usage statistics for chats, tokens, costs, and processes.' },
    { id: 'servers-toggle', tab: 'servers', label: 'Servers', icon: '🖥', description: 'Browse running CoC server instances and their health.' },
];
export const TOOL_TAB_GROUP_LABELS: Partial<Record<DashboardTab, string>> = {
    memory: 'Knowledge',
    skills: 'Knowledge',
    servers: 'Configure',
    stats: 'Operations',
    logs: 'Operations',
};
const TOOL_NAV_LOOKUP: ReadonlyMap<DashboardTab, ToolNavItem> = new Map(ALL_TOOL_NAV_ITEMS.map(item => [item.tab, item]));

type AdminNavAction =
    | { kind: 'settings'; subTab: SettingsSubTab }
    | { kind: 'admin'; tab: AdminSubTab }
    | { kind: 'tool'; tab: DashboardTab };

interface AdminNavItem {
    key: string;
    label: string;
    icon: string;
    testId: string;
    action: AdminNavAction;
}

interface AdminNavGroup {
    label: string;
    items: AdminNavItem[];
}

const ADMIN_TAB_GROUP_LABELS: Partial<Record<AdminSubTab, string>> = {
    messaging: 'Connections',
    server: 'Operations',
    data: 'Operations',
    prompts: 'Developer / Internals',
    database: 'Developer / Internals',
    agents: 'Configure',
};

function settingsNavItem(subTab: SettingsSubTab): AdminNavItem {
    const meta = getSettingsSubTabMeta(subTab);
    return {
        key: `settings:${subTab}`,
        label: meta.label,
        icon: meta.icon,
        testId: `settings-subtab-${subTab}`,
        action: { kind: 'settings', subTab },
    };
}

function adminNavItem(tab: AdminSubTab): AdminNavItem {
    return {
        key: `admin:${tab}`,
        label: TAB_LABELS[tab],
        icon: TAB_ICONS[tab],
        testId: `admin-tab-${tab}`,
        action: { kind: 'admin', tab },
    };
}

function toolNavItem(tab: DashboardTab): AdminNavItem {
    const item = TOOL_NAV_LOOKUP.get(tab);
    if (!item) {
        throw new Error(`Unknown admin tool tab: ${tab}`);
    }
    return {
        key: `tool:${tab}`,
        label: item.label,
        icon: item.icon,
        testId: item.id,
        action: { kind: 'tool', tab },
    };
}

// ── SDK Install Badge ──────────────────────────────────────────────────────

const SDK_INSTALL_BADGE_LABEL: Record<ProviderInstallStatus, string> = {
    'not-installed': 'Not Installed',
    'installing': 'Installing…',
    'installed': 'Installed',
    'install-failed': 'Install Failed',
};
const SDK_INSTALL_BADGE_CLASS: Record<ProviderInstallStatus, string> = {
    'not-installed': 'ar-badge',
    'installing': 'ar-badge ar-badge-accent',
    'installed': 'ar-badge ar-badge-success',
    'install-failed': 'ar-badge ar-badge-danger',
};

function SdkInstallBadge({ status }: { status: ProviderInstallStatus }) {
    return (
        <span className={SDK_INSTALL_BADGE_CLASS[status]} data-testid={`sdk-install-badge-${status}`}>
            {SDK_INSTALL_BADGE_LABEL[status]}
        </span>
    );
}

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
    const [configForm, setConfigForm] = useState<Record<string, string>>({});
    // Display settings
    const [showReportIntent, setShowReportIntent] = useState(false);
    const [toolCompactness, setToolCompactness] = useState<0 | 1 | 2 | 3>(3);
    const [taskCardDensity, setTaskCardDensity] = useState<'compact' | 'dense'>('dense');
    const [historyGrouping, setHistoryGrouping] = useState(true);

    // Chat settings
    const [chatFollowUpEnabled, setChatFollowUpEnabled] = useState(true);
    const [chatFollowUpCount, setChatFollowUpCount] = useState('3');
    const [chatAskUserEnabled, setChatAskUserEnabled] = useState(false);

    // Server name
    const [serverName, setServerName] = useState('');

    // Feature toggles
    const [featureValues, setFeatureValues] = useState<FeatureValues>(() => readFeatureValues(undefined));
    const [autoAgentProviderRoutingEnabled, setAutoAgentProviderRoutingEnabled] = useState(false);
    const [codexEnabled, setCodexEnabled] = useState(false);
    const [claudeEnabled, setClaudeEnabled] = useState(false);
    const [defaultProvider, setDefaultProvider] = useState<AdminDefaultProvider>('copilot');
    const [autoRoutingConfig, setAutoRoutingConfig] = useState<NormalizedAutoProviderRoutingConfig>(() => normalizeAutoProviderRoutingConfig(undefined));
    const [providerAvailability, setProviderAvailability] = useState<Record<string, { available: boolean; error?: string }>>({});
    const [sdkInstallStatuses, setSdkInstallStatuses] = useState<Record<string, ProviderInstallStatus>>({});
    const [sdkInstallErrors, setSdkInstallErrors] = useState<Record<string, string | undefined>>({});
    const sdkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Preferences(theme, reposSidebarCollapsed, uiLayoutMode) — for Appearance card
    const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
    const [reposSidebarCollapsed, setReposSidebarCollapsed] = useState(false);
    const [uiLayoutMode, setUiLayoutMode] = useState<'classic' | 'dev-workflow'>('classic');
    const [htmlEmbedEnabled, setHtmlEmbedEnabled] = useState(true);
    const [promptAutocompleteEnabled, setPromptAutocompleteEnabled] = useState(false);
    const [promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled] = useState(false);

    // Link handlers — shared module-level state via hook
    const [linkHandlersConfig, setHandlerEnabled] = useLinkHandlers();

    // Per-card saving state
    const [aiExecSaving, setAiExecSaving] = useState(false);
    const [chatSaving, setChatSaving] = useState(false);
    const [appearanceSaving, setAppearanceSaving] = useState(false);
    const [featuresSaving, setFeaturesSaving] = useState(false);
    const [defaultProviderSaving, setDefaultProviderSaving] = useState(false);

    // Quota state
    const [quotaData, setQuotaData] = useState<import('@plusplusoneplusplus/coc-client').AgentProvidersQuotaResponse | null>(null);
    const [quotaLoading, setQuotaLoading] = useState(false);
    const [quotaError, setQuotaError] = useState<string | null>(null);
    const [dreamProviderActivity, setDreamProviderActivity] = useState<AgentProviderWorkActivity[]>([]);
    const [dreamProviderActivityError, setDreamProviderActivityError] = useState<string | null>(null);

    // Snapshots for per-card dirty tracking (set when config/prefs loads)
    const [aiExecSnapshot, setAiExecSnapshot] = useState({ model: '', parallel: '1', timeout: '', output: 'table' });
    const [defaultProviderSnapshot, setDefaultProviderSnapshot] = useState<DefaultProviderSnapshot>({
        provider: 'copilot',
        codexEnabled: false,
        claudeEnabled: false,
        autoAgentProviderRouting: false,
        autoRoutingConfig: normalizeAutoProviderRoutingConfig(undefined),
    });
    const [chatSnapshot, setChatSnapshot] = useState({ followUpEnabled: true, followUpCount: '3', askUserEnabled: false, showReportIntent: false, toolCompactness: 3 as 0 | 1 | 2 | 3 });
    const [appearanceSnapshot, setAppearanceSnapshot] = useState({
        theme: 'auto' as string,
        reposSidebarCollapsed: false,
        uiLayoutMode: 'classic' as string,
        htmlEmbedEnabled: true,
        promptAutocompleteEnabled: false,
        promptAutocompleteAiEnabled: false,
        taskCardDensity: 'compact' as 'compact' | 'dense',
        historyGrouping: true,
    });
    const [featuresSnapshot, setFeaturesSnapshot] = useState<FeatureValues>(() => readFeatureValues(undefined));

    // Export
    const [exportStatus, setExportStatus] = useState<string>('');

    // Import
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
    const [importPreview, setImportPreview] = useState<string | null>(null);
    const [importStatus, setImportStatus] = useState<string>('');

    // Wipe
    const [wipeToken, setWipeToken] = useState<string | null>(null);
    const [includeWikis, setIncludeWikis] = useState(false);
    const [wipeStatus, setWipeStatus] = useState<string>('');
    const [wipePreview, setWipePreview] = useState<string | null>(null);

    // Restart
    const [restarting, setRestarting] = useState(false);
    const [restartStatus, setRestartStatus] = useState<string>('');

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
            const form = {
                model: resolved.model ?? '',
                parallel: String(resolved.parallel ?? 1),
                timeout: resolved.timeout != null ? String(resolved.timeout) : '',
                output: resolved.output ?? 'table',
            };
            setConfigForm(form);
            const sri = resolved.showReportIntent ?? false;
            const tc = (resolved.toolCompactness ?? 1) as 0 | 1 | 2 | 3;
            const fue = resolved.chat?.followUpSuggestions?.enabled ?? true;
            const fuc = String(resolved.chat?.followUpSuggestions?.count ?? 3);
            const aue = resolved.chat?.askUser?.enabled ?? false;
            setShowReportIntent(sri);
            setToolCompactness(tc);
            setChatFollowUpEnabled(fue);
            setChatFollowUpCount(fuc);
            setChatAskUserEnabled(aue);
            setChatSnapshot({ followUpEnabled: fue, followUpCount: fuc, askUserEnabled: aue, showReportIntent: sri, toolCompactness: tc });
            const tcd = (resolved.taskCardDensity === 'dense' ? 'dense' : 'compact') as 'compact' | 'dense';
            const hg = resolved.historyGrouping ?? true;
            setTaskCardDensity(tcd);
            setHistoryGrouping(hg);
            setAppearanceSnapshot(prev => ({ ...prev, taskCardDensity: tcd, historyGrouping: hg }));
            setServerName(resolved.serve?.serverName ?? '');
            const loadedFeatures = readFeatureValues(resolved);
            setFeatureValues(loadedFeatures);
            setFeaturesSnapshot(loadedFeatures);
            const aapre = resolved.features?.autoAgentProviderRouting ?? false;
            setAutoAgentProviderRoutingEnabled(aapre);
            const cxe = resolved.codex?.enabled ?? false;
            setCodexEnabled(cxe);
            const cle = resolved.claude?.enabled ?? false;
            setClaudeEnabled(cle);
            const dp = (resolved.defaultProvider === 'codex' ? 'codex' : resolved.defaultProvider === 'claude' ? 'claude' : 'copilot') as AdminDefaultProvider;
            const arc = normalizeAutoProviderRoutingConfig(resolved.agentProviderRouting?.auto);
            setDefaultProvider(dp);
            setAutoRoutingConfig(arc);
            setAiExecSnapshot({ model: form.model, parallel: form.parallel, timeout: form.timeout, output: form.output });
            setDefaultProviderSnapshot({ provider: dp, codexEnabled: cxe, claudeEnabled: cle, autoAgentProviderRouting: aapre, autoRoutingConfig: arc });
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
    }, []);

    const loadPreferences = useCallback(async () => {
        try {
            const data = await getSpaCocClient().preferences.getGlobal();
            const t = (data.theme ?? 'auto') as 'light' | 'dark' | 'auto';
            const r = data.reposSidebarCollapsed ?? false;
            const u = (data.uiLayoutMode === 'classic' || data.uiLayoutMode === 'dev-workflow') ? data.uiLayoutMode : 'classic';
            const h = data.htmlEmbed?.enabled !== false;
            const pae = data.promptAutocomplete?.enabled === true;
            const paai = data.promptAutocomplete?.ai?.enabled === true;
            setTheme(t);
            setReposSidebarCollapsed(r);
            setUiLayoutMode(u);
            setHtmlEmbedEnabled(h);
            setPromptAutocompleteEnabled(pae);
            setPromptAutocompleteAiEnabled(paai);
            setAppearanceSnapshot(prev => ({
                ...prev,
                theme: t,
                reposSidebarCollapsed: r,
                uiLayoutMode: u,
                htmlEmbedEnabled: h,
                promptAutocompleteEnabled: pae,
                promptAutocompleteAiEnabled: paai,
            }));
        } catch { /* ignore */ }
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

    useEffect(() => {
        loadStats();
        loadConfig();
        loadPreferences();
        getSpaCocClient().admin.getVersion()
            .then(data => { if (data) setVersionInfo(data); })
            .catch(() => { });
        fetch('/api/admin/providers/availability')
            .then(r => r.json())
            .then((data: Record<string, { available: boolean; error?: string }>) => setProviderAvailability(data))
            .catch(() => { });
        loadSdkInstallStatuses();
    }, [loadStats, loadConfig, loadPreferences, loadSdkInstallStatuses]);

    // ── Per-card dirty state ──
    const aiExecDirty = configForm.model !== aiExecSnapshot.model ||
        configForm.parallel !== aiExecSnapshot.parallel ||
        configForm.timeout !== aiExecSnapshot.timeout ||
        configForm.output !== aiExecSnapshot.output;

    const defaultProviderDirty = defaultProvider !== defaultProviderSnapshot.provider ||
        codexEnabled !== defaultProviderSnapshot.codexEnabled ||
        claudeEnabled !== defaultProviderSnapshot.claudeEnabled ||
        autoAgentProviderRoutingEnabled !== defaultProviderSnapshot.autoAgentProviderRouting ||
        !autoRoutingConfigsEqual(autoRoutingConfig, defaultProviderSnapshot.autoRoutingConfig);

    const chatDirty = chatFollowUpEnabled !== chatSnapshot.followUpEnabled ||
        chatFollowUpCount !== chatSnapshot.followUpCount ||
        chatAskUserEnabled !== chatSnapshot.askUserEnabled ||
        showReportIntent !== chatSnapshot.showReportIntent ||
        toolCompactness !== chatSnapshot.toolCompactness;

    const appearanceDirty = theme !== appearanceSnapshot.theme ||
        reposSidebarCollapsed !== appearanceSnapshot.reposSidebarCollapsed ||
        uiLayoutMode !== appearanceSnapshot.uiLayoutMode ||
        htmlEmbedEnabled !== appearanceSnapshot.htmlEmbedEnabled ||
        promptAutocompleteEnabled !== appearanceSnapshot.promptAutocompleteEnabled ||
        promptAutocompleteAiEnabled !== appearanceSnapshot.promptAutocompleteAiEnabled ||
        taskCardDensity !== appearanceSnapshot.taskCardDensity ||
        historyGrouping !== appearanceSnapshot.historyGrouping;

    const featuresDirty = FEATURES_CARD_SETTINGS.some(def => featureValues[def.key] !== featuresSnapshot[def.key]);

    // ── AI & Execution card ──
    const handleSaveAiExec = useCallback(async () => {
        const errors: string[] = [];
        const parallel = Number(configForm.parallel);
        if (isNaN(parallel) || parallel < 1) errors.push('Parallelism must be at least 1');
        const timeoutStr = configForm.timeout.trim();
        let timeoutValue: number | null = null;
        if (timeoutStr !== '') {
            const timeout = Number(timeoutStr);
            if (isNaN(timeout) || !Number.isInteger(timeout) || timeout < 1) {
                errors.push('Timeout must be a positive integer');
            } else {
                timeoutValue = timeout;
            }
        }
        if (!(VALID_OUTPUT_OPTIONS as readonly string[]).includes(configForm.output)) {
            errors.push(`Output must be one of: ${VALID_OUTPUT_OPTIONS.join(', ')}`);
        }
        if (errors.length) { addToast(errors.join('; '), 'error'); return; }
        setAiExecSaving(true);
        try {
            const payload: Record<string, unknown> = { parallel, output: configForm.output };
            if (configForm.model?.trim()) payload.model = configForm.model.trim();
            payload.timeout = timeoutValue;
            await getSpaCocClient().admin.updateConfig(payload);
            addToast('Settings saved', 'success');
            setAiExecSnapshot({ ...configForm });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setAiExecSaving(false);
        }
    }, [configForm, addToast]);

    const handleCancelAiExec = useCallback(() => {
        setConfigForm({ ...aiExecSnapshot });
    }, [aiExecSnapshot]);

    // ── Default Provider card (Agents tab) ──
    const handleSaveDefaultProvider = useCallback(async () => {
        setDefaultProviderSaving(true);
        try {
            const normalizedAutoRouting = normalizeAutoProviderRoutingConfig(autoRoutingConfig);
            const payload: Record<string, unknown> = {
                defaultProvider,
                'codex.enabled': codexEnabled,
                'claude.enabled': claudeEnabled,
                'features.autoAgentProviderRouting': autoAgentProviderRoutingEnabled,
            };
            if (autoAgentProviderRoutingEnabled) {
                payload['agentProviderRouting.auto'] = normalizedAutoRouting;
            }
            await getSpaCocClient().admin.updateConfig(payload);
            addToast('AI provider settings saved — restart required to apply changes', 'success');
            setAutoRoutingConfig(normalizedAutoRouting);
            setDefaultProviderSnapshot({ provider: defaultProvider, codexEnabled, claudeEnabled, autoAgentProviderRouting: autoAgentProviderRoutingEnabled, autoRoutingConfig: normalizedAutoRouting });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setDefaultProviderSaving(false);
        }
    }, [defaultProvider, autoAgentProviderRoutingEnabled, codexEnabled, claudeEnabled, autoRoutingConfig, addToast]);

    const handleCancelDefaultProvider = useCallback(() => {
        setDefaultProvider(defaultProviderSnapshot.provider);
        setCodexEnabled(defaultProviderSnapshot.codexEnabled);
        setClaudeEnabled(defaultProviderSnapshot.claudeEnabled);
        setAutoAgentProviderRoutingEnabled(defaultProviderSnapshot.autoAgentProviderRouting);
        setAutoRoutingConfig(defaultProviderSnapshot.autoRoutingConfig);
    }, [defaultProviderSnapshot]);

    // ── SDK install status helpers ──

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

    const refreshDreamProviderActivity = useCallback(async () => {
        setDreamProviderActivityError(null);
        try {
            setDreamProviderActivity(await loadDreamProviderActivity());
        } catch (err: unknown) {
            setDreamProviderActivityError(getSpaCocClientErrorMessage(err, 'Failed to fetch Dreams provider activity'));
        }
    }, []);

    useEffect(() => {
        if (activeTab !== 'agents' || isContainerMode()) {
            return;
        }
        void handleRefreshQuota();
        void refreshDreamProviderActivity();
    }, [activeTab, handleRefreshQuota, refreshDreamProviderActivity]);

    // ── Chat Experience card ──
    const handleSaveChat = useCallback(async () => {
        const errors: string[] = [];
        const count = Number(chatFollowUpCount);
        if (isNaN(count) || !Number.isInteger(count) || count < 1 || count > 5) {
            errors.push('Follow-up count must be an integer between 1 and 5');
        }
        if (errors.length) { addToast(errors.join('; '), 'error'); return; }
        setChatSaving(true);
        try {
            const payload: Record<string, unknown> = {
                'chat.followUpSuggestions.enabled': chatFollowUpEnabled,
                'chat.followUpSuggestions.count': count,
                'chat.askUser.enabled': chatAskUserEnabled,
                showReportIntent,
                toolCompactness,
            };
            await getSpaCocClient().admin.updateConfig(payload);
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            setChatSnapshot({ followUpEnabled: chatFollowUpEnabled, followUpCount: chatFollowUpCount, askUserEnabled: chatAskUserEnabled, showReportIntent, toolCompactness });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setChatSaving(false);
        }
    }, [chatFollowUpEnabled, chatFollowUpCount, chatAskUserEnabled, showReportIntent, toolCompactness, addToast]);

    const handleCancelChat = useCallback(() => {
        setChatFollowUpEnabled(chatSnapshot.followUpEnabled);
        setChatFollowUpCount(chatSnapshot.followUpCount);
        setChatAskUserEnabled(chatSnapshot.askUserEnabled);
        setShowReportIntent(chatSnapshot.showReportIntent);
        setToolCompactness(chatSnapshot.toolCompactness);
    }, [chatSnapshot]);

    // ── Appearance & Navigation card ──
    const handleSaveAppearance = useCallback(async () => {
        setAppearanceSaving(true);
        try {
            // Save preferences (theme, reposSidebarCollapsed, uiLayoutMode, htmlEmbed)
            const prefsChanged = theme !== appearanceSnapshot.theme ||
                reposSidebarCollapsed !== appearanceSnapshot.reposSidebarCollapsed ||
                uiLayoutMode !== appearanceSnapshot.uiLayoutMode ||
                htmlEmbedEnabled !== appearanceSnapshot.htmlEmbedEnabled ||
                promptAutocompleteEnabled !== appearanceSnapshot.promptAutocompleteEnabled ||
                promptAutocompleteAiEnabled !== appearanceSnapshot.promptAutocompleteAiEnabled;
            if (prefsChanged) {
                await getSpaCocClient().preferences.patchGlobal({
                    theme,
                    reposSidebarCollapsed,
                    uiLayoutMode,
                    htmlEmbed: { enabled: htmlEmbedEnabled },
                    promptAutocomplete: {
                        enabled: promptAutocompleteEnabled,
                        ai: { enabled: promptAutocompleteAiEnabled },
                    },
                });
            }
            // Save config (taskCardDensity, historyGrouping)
            const configChanged = taskCardDensity !== appearanceSnapshot.taskCardDensity || historyGrouping !== appearanceSnapshot.historyGrouping;
            if (configChanged) {
                await getSpaCocClient().admin.updateConfig({ taskCardDensity, historyGrouping });
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            invalidateHtmlEmbedPreference();
            setAppearanceSnapshot({
                theme,
                reposSidebarCollapsed,
                uiLayoutMode,
                htmlEmbedEnabled,
                promptAutocompleteEnabled,
                promptAutocompleteAiEnabled,
                taskCardDensity,
                historyGrouping,
            });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setAppearanceSaving(false);
        }
    }, [theme, reposSidebarCollapsed, uiLayoutMode, htmlEmbedEnabled, promptAutocompleteEnabled, promptAutocompleteAiEnabled, taskCardDensity, historyGrouping, appearanceSnapshot, addToast]);

    const handleCancelAppearance = useCallback(() => {
        setTheme(appearanceSnapshot.theme as 'light' | 'dark' | 'auto');
        setReposSidebarCollapsed(appearanceSnapshot.reposSidebarCollapsed);
        setUiLayoutMode(appearanceSnapshot.uiLayoutMode as 'classic' | 'dev-workflow');
        setHtmlEmbedEnabled(appearanceSnapshot.htmlEmbedEnabled);
        setPromptAutocompleteEnabled(appearanceSnapshot.promptAutocompleteEnabled);
        setPromptAutocompleteAiEnabled(appearanceSnapshot.promptAutocompleteAiEnabled);
        setTaskCardDensity(appearanceSnapshot.taskCardDensity);
        setHistoryGrouping(appearanceSnapshot.historyGrouping);
    }, [appearanceSnapshot]);

    // ── Workspace Features card ──
    const handleSaveFeatures = useCallback(async () => {
        setFeaturesSaving(true);
        try {
            await getSpaCocClient().admin.updateConfig({ ...featureValues });
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            setFeaturesSnapshot({ ...featureValues });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setFeaturesSaving(false);
        }
    }, [featureValues, addToast]);

    const handleCancelFeatures = useCallback(() => {
        setFeatureValues({ ...featuresSnapshot });
    }, [featuresSnapshot]);

    const handleSaveServerName = useCallback(async () => {
        const trimmed = serverName.trim();
        try {
            await getSpaCocClient().admin.updateConfig({ 'serve.serverName': trimmed || null });
            setServerName(trimmed);
            addToast('Server name saved — takes effect on next page reload', 'success');
            await loadConfig();
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Could not save server name'), 'error');
        }
    }, [serverName, addToast, loadConfig]);

    const handleExport = useCallback(async () => {
        setExportStatus('Exporting…');
        try {
            const res = await getSpaCocClient().admin.exportData();
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const message = typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : res.statusText;
                throw new Error(message);
            }
            const disposition = res.headers.get('Content-Disposition') || '';
            const match = disposition.match(/filename="([^"]+)"/);
            const filename = match ? match[1] : `coc-export-${new Date().toISOString().replace(/:/g, '-')}.json`;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setExportStatus('Exported successfully.');
        } catch (err: unknown) {
            setExportStatus('Export failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
        }
    }, []);

    const handlePreviewImport = useCallback(async () => {
        if (!importFile) { setImportStatus('Please select a JSON file first.'); return; }
        setImportStatus('Loading preview…');
        try {
            const text = await importFile.text();
            const payload = JSON.parse(text);
            const data = await getSpaCocClient().admin.previewImport(payload);
            if (!data.valid) {
                setImportPreview('Preview failed: ' + (data?.error || 'Invalid file'));
                setImportStatus('Preview failed.');
                return;
            }
            const p = data.preview;
            const lines: string[] = [];
            if (p.processCount != null) lines.push('Processes: ' + p.processCount);
            if (p.workspaceCount != null) lines.push('Workspaces: ' + p.workspaceCount);
            if (p.wikiCount != null) lines.push('Wikis: ' + p.wikiCount);
            setImportPreview(lines.length ? lines.join('\n') : JSON.stringify(p, null, 2));
            setImportStatus('Preview loaded.');
        } catch (err: unknown) {
            if (err instanceof SyntaxError) {
                setImportPreview(null);
                setImportStatus('Invalid JSON file.');
            } else {
                setImportPreview('Preview failed: ' + getSpaCocClientErrorMessage(err, 'Invalid file'));
                setImportStatus('Preview failed.');
            }
        }
    }, [importFile]);

    const handleImport = useCallback(async () => {
        if (!importFile) { setImportStatus('Please select a JSON file first.'); return; }
        setImportStatus('Requesting confirmation token…');
        let payload: unknown;
        try {
            const text = await importFile.text();
            payload = JSON.parse(text);
        } catch (err: unknown) {
            setImportStatus('Import failed: ' + getSpaCocClientErrorMessage(err, 'Invalid JSON file.'));
            return;
        }
        let tokenRes: { token?: string } | null = null;
        try {
            tokenRes = await getSpaCocClient().admin.getImportToken();
        } catch {
            setImportStatus('Failed to get import token.');
            return;
        }
        if (!tokenRes?.token) { setImportStatus('Failed to get import token.'); return; }
        setImportStatus('Importing…');
        try {
            await getSpaCocClient().admin.importData(payload, { token: tokenRes.token, mode: importMode });
            setImportStatus('Import complete.');
            addToast('Import complete', 'success');
            loadStats();
        } catch (err: unknown) {
            setImportStatus('Import failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
        }
    }, [importFile, importMode, addToast, loadStats]);

    const handlePreviewWipe = useCallback(async () => {
        try {
            const data = await getSpaCocClient().admin.getDataStats({ includeWikis });
            const lines: string[] = [];
            if (data.processCount != null) lines.push('Processes: ' + data.processCount);
            if (data.wikiCount != null) lines.push('Wikis: ' + data.wikiCount);
            if (data.totalBytes != null) lines.push('Disk: ' + formatBytes(data.totalBytes));
            setWipePreview(lines.length ? lines.join('\n') : JSON.stringify(data, null, 2));
        } catch {
            setWipePreview('Failed to load preview.');
        }
    }, [includeWikis]);

    const handleWipeStep1 = useCallback(async () => {
        setWipeStatus('Requesting confirmation token…');
        try {
            const data = await getSpaCocClient().admin.getWipeToken();
            if (!data.token) throw new Error('No token received');
            setWipeToken(data.token);
            setWipeStatus('');
        } catch (err: unknown) {
            const detail = getSpaCocClientErrorMessage(err, '');
            setWipeStatus(detail ? `Failed to get wipe token: ${detail}` : 'Failed to get wipe token');
        }
    }, []);

    const handleWipeConfirm = useCallback(async () => {
        if (!wipeToken) return;
        setWipeStatus('Wiping data…');
        try {
            await getSpaCocClient().admin.wipeData({ token: wipeToken, includeWikis });
            setWipeStatus('Data wiped successfully.');
            addToast('Data wiped', 'success');
            setWipeToken(null);
            loadStats();
        } catch (err: unknown) {
            setWipeStatus('Wipe failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
        }
    }, [wipeToken, includeWikis, addToast, loadStats]);

    const handleWipeCancel = useCallback(() => {
        setWipeToken(null);
        setWipeStatus('Cancelled.');
    }, []);

    const handleRestart = useCallback(async () => {
        setRestarting(true);
        setRestartStatus('Sending restart request…');
        try {
            await getSpaCocClient().admin.restart();
            setRestartStatus('Server is restarting. Waiting for it to come back…');
            addToast('Restart initiated — rebuilding…', 'success');
            // Poll until the server comes back, then reload the page
            const poll = () => {
                setTimeout(async () => {
                    try {
                        await getSpaCocClient().admin.getDataStats(undefined, { signal: AbortSignal.timeout(2000) });
                        setRestartStatus('Server is back!');
                        window.location.reload();
                        return;
                    } catch { /* server still down */ }
                    poll();
                }, 3000);
            };
            poll();
        } catch (err: unknown) {
            setRestartStatus('Restart failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
            setRestarting(false);
        }
    }, [addToast]);

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

    // Servers row is gated by the dashboard runtime config, same source the
    // legacy topbar dropdown consulted. It is independent of the editable
    // `serversEnabled` Features form state above.
    const serversNavItems = isServersEnabled() ? [toolNavItem('servers')] : [];
    const containerNavItems = isContainerMode() ? [adminNavItem('messaging')] : [];
    const containerAgentsNavItem = isContainerMode() ? [adminNavItem('agents')] : [];
    const nonContainerAgentsNavItem = !isContainerMode() ? [adminNavItem('agents')] : [];

    const handleToolNavClick = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        window.location.hash = '#' + tab;
    }, [dispatch]);

    const navGroups: AdminNavGroup[] = [
        {
            label: 'Configure',
            items: [
                {
                    key: 'settings:configure',
                    label: 'Configure',
                    icon: '✦',
                    testId: 'settings-nav-configure',
                    action: { kind: 'settings', subTab: DEFAULT_SETTINGS_SUBTAB } as AdminNavAction,
                },
                ...nonContainerAgentsNavItem,
                ...serversNavItems,
            ],
        },
        {
            label: 'Knowledge',
            items: [
                toolNavItem('memory'),
                toolNavItem('skills'),
            ],
        },
        {
            label: 'Connections',
            items: [
                ...containerNavItems,
                ...containerAgentsNavItem,
            ],
        },
        {
            label: 'Operations',
            items: [
                toolNavItem('stats'),
                toolNavItem('logs'),
                adminNavItem('server'),
                adminNavItem('data'),
            ],
        },
        {
            label: 'Developer / Internals',
            items: [
                adminNavItem('prompts'),
                adminNavItem('database'),
                settingsNavItem('advanced'),
            ],
        },
    ].filter(group => group.items.length > 0);

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

    const activeNavKey = isToolEmbedded
        ? `tool:${activeDashboardTab}`
        : activeTab === 'settings'
            ? (settingsSubTab === 'advanced' ? 'settings:advanced' : 'settings:configure')
            : `admin:${activeTab}`;
    const activeTabLabel = activeTab === 'settings'
        ? getSettingsSubTabMeta(settingsSubTab).label
        : TAB_LABELS[activeTab];
    const activeBreadcrumbGroup = isToolEmbedded
        ? TOOL_TAB_GROUP_LABELS[activeDashboardTab] ?? 'Operations'
        : activeTab === 'settings'
            ? 'Configure'
            : ADMIN_TAB_GROUP_LABELS[activeTab] ?? 'Configure';
    const activePageDescription = activeTab === 'settings'
        ? SETTINGS_SUBTAB_DESCRIPTIONS[settingsSubTab]
        : TAB_DESCRIPTIONS[activeTab];

    return (
        <div id="view-admin" className="admin-redesign">
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
                        <button
                            type="button"
                            className="ar-sidebar-restart"
                            onClick={handleRestart}
                            disabled={restarting}
                            data-testid="sidebar-restart-btn"
                            title={restarting ? restartStatus : 'Rebuild & restart the CoC server'}
                        >
                            {restarting ? <><Spinner size="sm" /> Restarting…</> : '↻ Restart Server'}
                        </button>
                    </div>
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
                                                <SettingsCard
                                                    title="AI & Execution"
                                                    description="Default model, parallelism, timeout, and output format for AI tasks."
                                                    dirty={aiExecDirty}
                                                    saving={aiExecSaving}
                                                    onSave={handleSaveAiExec}
                                                    onCancel={handleCancelAiExec}
                                                    data-testid="settings-ai-execution"
                                                >
                                                    <AdminRow
                                                        name="Model"
                                                        hint="AI model identifier (leave blank to use server default)."
                                                    >
                                                        <input
                                                            id="admin-config-model"
                                                            className="ar-input ar-long ar-mono"
                                                            value={configForm.model}
                                                            onChange={e => setConfigForm(f => ({ ...f, model: e.target.value }))}
                                                        />
                                                        <SourceBadge source={sources['model']} isDefault={isDefaultValue('model')} />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Parallelism"
                                                        hint="Number of parallel AI tasks. Read-write tasks always run sequentially."
                                                    >
                                                        <input
                                                            id="admin-config-parallel"
                                                            type="number"
                                                            min={1}
                                                            className="ar-input ar-short"
                                                            value={configForm.parallel}
                                                            onChange={e => setConfigForm(f => ({ ...f, parallel: e.target.value }))}
                                                        />
                                                        <SourceBadge source={sources['parallel']} isDefault={isDefaultValue('parallel')} />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Timeout"
                                                        hint="Per-task wall-clock limit. Leave blank for the 1-hour default."
                                                    >
                                                        <AdminInputSuffix suffix="sec">
                                                            <input
                                                                id="admin-config-timeout"
                                                                type="number"
                                                                min={1}
                                                                placeholder="3600"
                                                                className="ar-input ar-short"
                                                                value={configForm.timeout}
                                                                onChange={e => setConfigForm(f => ({ ...f, timeout: e.target.value }))}
                                                            />
                                                        </AdminInputSuffix>
                                                        <SourceBadge source={sources['timeout']} isDefault={isDefaultValue('timeout')} />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Output"
                                                        hint="Default format for CLI commands that print structured data."
                                                    >
                                                        <select
                                                            id="admin-config-output"
                                                            className="ar-select ar-med"
                                                            value={configForm.output}
                                                            onChange={e => setConfigForm(f => ({ ...f, output: e.target.value }))}
                                                        >
                                                            {VALID_OUTPUT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                                        </select>
                                                        <SourceBadge source={sources['output']} isDefault={isDefaultValue('output')} />
                                                    </AdminRow>
                                                </SettingsCard>
                                            )}

                                            {/* ── Chat Experience ── */}
                                            {settingsSubTab === 'chat' && (
                                                <SettingsCard
                                                    title="Chat Experience"
                                                    description="Controls how the AI assistant behaves during conversations."
                                                    dirty={chatDirty}
                                                    saving={chatSaving}
                                                    onSave={handleSaveChat}
                                                    onCancel={handleCancelChat}
                                                    data-testid="settings-chat"
                                                >
                                                    <AdminRow
                                                        name="Follow-up suggestions"
                                                        hint="Generate clickable next-question chips after each response."
                                                    >
                                                        <SourceBadge source={sources['chat.followUpSuggestions.enabled']} isDefault={isDefaultValue('chat.followUpSuggestions.enabled')} />
                                                        <AdminToggle
                                                            checked={chatFollowUpEnabled}
                                                            onChange={setChatFollowUpEnabled}
                                                            data-testid="toggle-chat-followup-enabled"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Count"
                                                        hint="Number of follow-up suggestions to generate (1–5)."
                                                    >
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={5}
                                                            className="ar-input ar-short"
                                                            value={chatFollowUpCount}
                                                            onChange={e => setChatFollowUpCount(e.target.value)}
                                                            data-testid="input-chat-followup-count"
                                                        />
                                                        <SourceBadge source={sources['chat.followUpSuggestions.count']} isDefault={isDefaultValue('chat.followUpSuggestions.count')} />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Ask user (interactive questions)"
                                                        hint="Allow the AI to pause and ask the user a question mid-task instead of guessing."
                                                    >
                                                        <SourceBadge source={sources['chat.askUser.enabled']} isDefault={isDefaultValue('chat.askUser.enabled')} />
                                                        <AdminToggle
                                                            checked={chatAskUserEnabled}
                                                            onChange={setChatAskUserEnabled}
                                                            data-testid="toggle-chat-askuser-enabled"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Intent announcements"
                                                        hint="Show the report_intent badge above each tool call (“I'm about to read X…”)."
                                                    >
                                                        <SourceBadge source={sources['showReportIntent']} isDefault={isDefaultValue('showReportIntent')} />
                                                        <AdminToggle
                                                            checked={showReportIntent}
                                                            onChange={setShowReportIntent}
                                                            data-testid="toggle-show-report-intent"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Tool call verbosity"
                                                        hint="How much detail to show for each tool invocation in the transcript."
                                                    >
                                                        <SourceBadge source={sources['toolCompactness']} isDefault={isDefaultValue('toolCompactness')} />
                                                        <AdminSeg<0 | 1 | 2 | 3>
                                                            value={toolCompactness}
                                                            onChange={setToolCompactness}
                                                            aria-label="Tool call verbosity"
                                                            options={[
                                                                { value: 0, label: 'Full', testId: 'tool-compactness-full' },
                                                                { value: 1, label: 'Compact', testId: 'tool-compactness-compact' },
                                                                { value: 2, label: 'Minimal', testId: 'tool-compactness-minimal' },
                                                                { value: 3, label: 'Whisper', testId: 'tool-compactness-whisper' },
                                                            ]}
                                                        />
                                                    </AdminRow>
                                                </SettingsCard>
                                            )}

                                            {/* ── Appearance & Navigation ── */}
                                            {settingsSubTab === 'appearance' && (
                                                <SettingsCard
                                                    title="Appearance & Navigation"
                                                    badge="Global"
                                                    description="Theme, layout density, and navigation preferences."
                                                    dirty={appearanceDirty}
                                                    saving={appearanceSaving}
                                                    onSave={handleSaveAppearance}
                                                    onCancel={handleCancelAppearance}
                                                    data-testid="settings-appearance"
                                                >
                                                    <AdminRow name="Theme" hint="Color scheme for this device. Auto follows the OS preference.">
                                                        <select
                                                            className="ar-select ar-med"
                                                            value={theme}
                                                            onChange={e => setTheme(e.target.value as 'light' | 'dark' | 'auto')}
                                                            data-testid="pref-theme"
                                                        >
                                                            <option value="auto">auto</option>
                                                            <option value="light">light</option>
                                                            <option value="dark">dark</option>
                                                        </select>
                                                    </AdminRow>
                                                    <AdminRow name="UI Mode" hint="Classic shows the activity tab. Dev workflow uses chats, work items, and tasks.">
                                                        <select
                                                            className="ar-select ar-long"
                                                            value={uiLayoutMode}
                                                            onChange={e => setUiLayoutMode(e.target.value as 'classic' | 'dev-workflow')}
                                                            data-testid="pref-ui-layout-mode"
                                                        >
                                                            <option value="dev-workflow">Dev Workflow (Chats + Work Items + Tasks)</option>
                                                            <option value="classic">Classic (Activity)</option>
                                                        </select>
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Repos sidebar collapsed"
                                                        hint="Whether the repos sidebar starts collapsed on load."
                                                    >
                                                        <AdminToggle
                                                            checked={reposSidebarCollapsed}
                                                            onChange={setReposSidebarCollapsed}
                                                            data-testid="pref-repos-sidebar-collapsed"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Inline HTML previews"
                                                        hint={<>Render local <span className="ar-mono">.html</span> links titled <span className="ar-mono">embed</span> as sandboxed chat previews.</>}
                                                    >
                                                        <AdminToggle
                                                            checked={htmlEmbedEnabled}
                                                            onChange={setHtmlEmbedEnabled}
                                                            data-testid="pref-html-embed-enabled"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Prompt ghost text"
                                                        hint="Show inline autocomplete in Queue Task and follow-up inputs."
                                                    >
                                                        <AdminToggle
                                                            checked={promptAutocompleteEnabled}
                                                            onChange={setPromptAutocompleteEnabled}
                                                            data-testid="pref-prompt-autocomplete-enabled"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="AI prompt ghost text"
                                                        hint="Generate ghost text with AI using workspace-scoped user history. Disabled by default."
                                                    >
                                                        <AdminToggle
                                                            checked={promptAutocompleteAiEnabled}
                                                            disabled={!promptAutocompleteEnabled}
                                                            onChange={setPromptAutocompleteAiEnabled}
                                                            data-testid="pref-prompt-autocomplete-ai-enabled"
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="Task card density"
                                                        hint="Density of task cards in the activity tab."
                                                    >
                                                        <SourceBadge source={sources['taskCardDensity']} isDefault={isDefaultValue('taskCardDensity')} />
                                                        <AdminSeg<'compact' | 'dense'>
                                                            value={taskCardDensity}
                                                            onChange={setTaskCardDensity}
                                                            aria-label="Task card density"
                                                            options={[
                                                                { value: 'compact', label: 'Compact', testId: 'task-card-density-compact' },
                                                                { value: 'dense', label: 'Dense', testId: 'task-card-density-dense' },
                                                            ]}
                                                        />
                                                    </AdminRow>
                                                    <AdminRow
                                                        name="History grouping"
                                                        hint="Group related plan and autopilot tasks together in the history list."
                                                    >
                                                        <SourceBadge source={sources['historyGrouping']} isDefault={isDefaultValue('historyGrouping')} />
                                                        <AdminToggle
                                                            checked={historyGrouping}
                                                            onChange={setHistoryGrouping}
                                                            data-testid="toggle-history-grouping"
                                                        />
                                                    </AdminRow>
                                                </SettingsCard>
                                            )}

                                            {/* ── Workspace Features ── */}
                                            {settingsSubTab === 'features' && (
                                                <SettingsCard
                                                    title="Workspace Features"
                                                    description="Enable or disable optional dashboard features."
                                                    dirty={featuresDirty}
                                                    saving={featuresSaving}
                                                    onSave={handleSaveFeatures}
                                                    onCancel={handleCancelFeatures}
                                                    data-testid="settings-features"
                                                >
                                                    {FEATURE_CARD_GROUPS.map(group => (
                                                        <div className="ar-feature-group" data-testid={group.testId} key={group.id}>
                                                            <div className="ar-feature-group-head">{group.heading}</div>
                                                            {getFeatureCardSettings(group.id).map(def => {
                                                                const ui = def.ui!;
                                                                if (ui.dependsOn && featureValues[ui.dependsOn] !== true) {
                                                                    return null;
                                                                }
                                                                const badge = ui.badge ? FEATURE_BADGES[ui.badge] : undefined;
                                                                const name = badge
                                                                    ? <>{ui.label} <span className={badge.className}>{badge.label}</span></>
                                                                    : ui.label;
                                                                return (
                                                                    <AdminRow key={def.key} name={name} hint={ui.hint}>
                                                                        <SourceBadge source={sources[def.key]} isDefault={isDefaultValue(def.key)} />
                                                                        {ui.control?.type === 'select' ? (
                                                                            <select
                                                                                className="ar-select ar-med"
                                                                                value={String(featureValues[def.key] ?? '')}
                                                                                onChange={e => setFeatureValues(prev => ({ ...prev, [def.key]: e.target.value }))}
                                                                                data-testid={ui.testId}
                                                                            >
                                                                                {ui.control.options.map(option => (
                                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                                ))}
                                                                            </select>
                                                                        ) : (
                                                                            <AdminToggle
                                                                                checked={featureValues[def.key] === true}
                                                                                onChange={checked => setFeatureValues(prev => ({ ...prev, [def.key]: checked }))}
                                                                                data-testid={ui.testId}
                                                                            />
                                                                        )}
                                                                    </AdminRow>
                                                                );
                                                            })}
                                                        </div>
                                                    ))}
                                                </SettingsCard>
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
                                <>
                                    <section className="ar-card">
                                        <div style={{ padding: 4 }}>
                                            <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                                                <StorageSection />
                                            </Suspense>
                                        </div>
                                    </section>

                                    <section className="ar-card">
                                        <header className="ar-card-head">
                                            <div className="min-w-0 flex-1">
                                                <h3>Backup</h3>
                                                <p className="ar-card-desc">Export everything as JSON or restore from a previous export.</p>
                                            </div>
                                        </header>
                                        <div className="ar-card-body">
                                            <AdminRow
                                                name="Export all data"
                                                hint="Includes processes, workspaces, wikis, and preferences. Tokens are not exported."
                                            >
                                                <button id="admin-export-btn" type="button" className="ar-btn ar-btn-secondary ar-btn-sm" onClick={handleExport}>
                                                    Export JSON ↓
                                                </button>
                                                {exportStatus && <span id="admin-export-status" className="ar-muted" style={{ fontSize: 12 }}>{exportStatus}</span>}
                                            </AdminRow>
                                            <AdminRow
                                                name="Import from JSON"
                                                hint="Replace wipes existing rows; merge adds and updates only."
                                            >
                                                <div className="ar-hstack">
                                                    <AdminSeg<'replace' | 'merge'>
                                                        value={importMode}
                                                        onChange={setImportMode}
                                                        aria-label="Import mode"
                                                        options={[
                                                            { value: 'replace', label: 'Replace', testId: 'import-mode-replace' },
                                                            { value: 'merge', label: 'Merge', testId: 'import-mode-merge' },
                                                        ]}
                                                    />
                                                    <input
                                                        id="admin-import-file"
                                                        type="file"
                                                        accept=".json,application/json"
                                                        className="ar-input"
                                                        style={{ padding: '4px 8px', fontSize: 12 }}
                                                        onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                                                    />
                                                    <button id="admin-import-preview-btn" type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={handlePreviewImport}>Preview</button>
                                                    <button id="admin-import-btn" type="button" className="ar-btn ar-btn-primary ar-btn-sm" onClick={handleImport}>Import</button>
                                                    {importStatus && <span id="admin-import-status" className="ar-muted" style={{ fontSize: 12 }}>{importStatus}</span>}
                                                </div>
                                            </AdminRow>
                                            {importPreview && (
                                                <div className="ar-section">
                                                    <pre id="admin-import-preview" className="ar-pre">{importPreview}</pre>
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <section className="ar-card is-danger">
                                        <header className="ar-card-head">
                                            <div className="min-w-0 flex-1">
                                                <h3>Danger Zone</h3>
                                                <p className="ar-card-desc">Permanent destructive operations. Always preview before confirming.</p>
                                            </div>
                                            <div className="ar-badge-row">
                                                <span className="ar-badge ar-badge-danger">Irreversible</span>
                                            </div>
                                        </header>
                                        <div className="ar-card-body">
                                            <AdminRow
                                                name="Erase everything"
                                                hint="Deletes every process, conversation, and workspace. Tokens and preferences are kept."
                                            >
                                                <label className="ar-hstack" style={{ fontSize: 12, color: 'var(--ar-text-mute)', cursor: 'pointer' }}>
                                                    <input
                                                        id="admin-include-wikis"
                                                        type="checkbox"
                                                        checked={includeWikis}
                                                        onChange={e => setIncludeWikis(e.target.checked)}
                                                        style={{ accentColor: 'var(--ar-danger)' }}
                                                    />
                                                    Include wikis
                                                </label>
                                                <button id="admin-preview-wipe" type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={handlePreviewWipe}>Preview</button>
                                                {wipeToken === null ? (
                                                    <button id="admin-wipe-btn" type="button" className="ar-btn ar-btn-danger-outline ar-btn-sm" onClick={handleWipeStep1}>Wipe Data</button>
                                                ) : (
                                                    <>
                                                        <button id="admin-wipe-confirm" type="button" className="ar-btn ar-btn-danger ar-btn-sm" onClick={handleWipeConfirm}>Confirm Wipe</button>
                                                        <button id="admin-wipe-cancel" type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={handleWipeCancel}>Cancel</button>
                                                    </>
                                                )}
                                                {wipeStatus && <span id="admin-wipe-status" className="ar-muted" style={{ fontSize: 12 }}>{wipeStatus}</span>}
                                            </AdminRow>
                                            {wipePreview && (
                                                <div className="ar-section">
                                                    <pre id="admin-wipe-preview" className="ar-pre">{wipePreview}</pre>
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </>
                            )}

                            {/* ── Server tab ── */}
                            {activeTab === 'server' && (
                                <>
                                    <section className="ar-card">
                                        <header className="ar-card-head">
                                            <div className="min-w-0 flex-1">
                                                <h3>Runtime</h3>
                                                <p className="ar-card-desc">Live information about this server process.</p>
                                            </div>
                                            <div className="ar-badge-row">
                                                <span className="ar-pill"><span className="ar-pill-dot" /> Healthy</span>
                                            </div>
                                        </header>
                                        <div className="ar-card-body">
                                            {config?.configFilePath && (
                                                <AdminRow name="Config file">
                                                    <code className="ar-code">{config.configFilePath}</code>
                                                </AdminRow>
                                            )}
                                            <AdminRow name="Listening on">
                                                <code className="ar-code">{resolved.serve?.host ?? '127.0.0.1'}:{resolved.serve?.port ?? '4000'}</code>
                                            </AdminRow>
                                            {resolved.serve?.dataDir && (
                                                <AdminRow name="Data directory">
                                                    <code className="ar-code">{resolved.serve.dataDir}</code>
                                                </AdminRow>
                                            )}
                                            {versionInfo && (
                                                <AdminRow name="Version">
                                                    <code className="ar-code">{versionInfo.version}</code>
                                                    <span className="ar-muted" style={{ fontSize: 12 }}>commit</span>
                                                    <code className="ar-code" title={versionInfo.commit}>{versionInfo.commit.slice(0, 7)}</code>
                                                </AdminRow>
                                            )}
                                        </div>
                                    </section>

                                    <section className="ar-card">
                                        <header className="ar-card-head">
                                            <div className="min-w-0 flex-1">
                                                <h3>Display name</h3>
                                                <p className="ar-card-desc">
                                                    Short name shown in the dashboard title bar (e.g. <code className="ar-code">MBP</code>). Leave blank to use the auto-shortened hostname. Takes effect on next page reload.
                                                </p>
                                            </div>
                                        </header>
                                        <div className="ar-card-body">
                                            <AdminRow name="Name">
                                                <input
                                                    id="admin-server-name"
                                                    type="text"
                                                    maxLength={64}
                                                    placeholder={resolved.serve?.host ? `auto (${resolved.serve.host})` : 'auto'}
                                                    value={serverName}
                                                    onChange={e => setServerName(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveServerName(); }}
                                                    className="ar-input ar-long ar-mono"
                                                />
                                                <SourceBadge source={sources['serve.serverName']} isDefault={isDefaultValue('serve.serverName')} />
                                                <button id="admin-server-name-save" type="button" className="ar-btn ar-btn-primary ar-btn-sm" onClick={handleSaveServerName}>Save</button>
                                            </AdminRow>
                                        </div>
                                    </section>

                                    {!isContainerMode() && (
                                        <section className="ar-card">
                                            <header className="ar-card-head">
                                                <div className="min-w-0 flex-1">
                                                    <h3>Container Link</h3>
                                                    <p className="ar-card-desc">
                                                        Connect this agent to a container server using the call-home pattern. The agent connects outbound via WebSocket — no inbound port required.
                                                    </p>
                                                </div>
                                            </header>
                                            <Suspense fallback={<div style={{ padding: 16 }}><Spinner size="sm" /></div>}>
                                                <ContainerLinkSection onError={msg => addToast(msg, 'error')} />
                                            </Suspense>
                                        </section>
                                    )}

                                    <section className="ar-card">
                                        <header className="ar-card-head">
                                            <div className="min-w-0 flex-1">
                                                <h3>Lifecycle</h3>
                                                <p className="ar-card-desc">Rebuild and restart the CoC server process. Active sessions reconnect automatically.</p>
                                            </div>
                                        </header>
                                        <div className="ar-card-body">
                                            <AdminRow
                                                name="Rebuild & restart"
                                                hint="Runs npm rebuild and re-launches the server."
                                            >
                                                <button
                                                    id="admin-restart-btn"
                                                    type="button"
                                                    className="ar-btn ar-btn-secondary ar-btn-sm"
                                                    onClick={handleRestart}
                                                    disabled={restarting}
                                                >
                                                    {restarting && <Spinner size="sm" />}
                                                    {restarting ? 'Restarting…' : 'Rebuild & Restart'}
                                                </button>
                                                {restartStatus && <span id="admin-restart-status" className="ar-muted" style={{ fontSize: 12 }}>{restartStatus}</span>}
                                            </AdminRow>
                                        </div>
                                    </section>
                                </>
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
                                    defaultProvider={defaultProvider}
                                    setDefaultProvider={setDefaultProvider}
                                    codexEnabled={codexEnabled}
                                    setCodexEnabled={setCodexEnabled}
                                    claudeEnabled={claudeEnabled}
                                    setClaudeEnabled={setClaudeEnabled}
                                    autoAgentProviderRoutingEnabled={autoAgentProviderRoutingEnabled}
                                    setAutoAgentProviderRoutingEnabled={setAutoAgentProviderRoutingEnabled}
                                    autoRoutingConfig={autoRoutingConfig}
                                    setAutoRoutingConfig={setAutoRoutingConfig}
                                    providerAvailability={providerAvailability}
                                    sdkInstallStatuses={sdkInstallStatuses}
                                    sdkInstallErrors={sdkInstallErrors}
                                    onInstallSdk={handleInstallSdk}
                                    dirty={defaultProviderDirty}
                                    saving={defaultProviderSaving}
                                    onSave={handleSaveDefaultProvider}
                                    onCancel={handleCancelDefaultProvider}
                                    quotaData={quotaData}
                                    quotaLoading={quotaLoading}
                                    quotaError={quotaError}
                                    onRefreshQuota={handleRefreshQuota}
                                    providerActivity={dreamProviderActivity}
                                    providerActivityError={dreamProviderActivityError}
                                    onRefreshProviderActivity={refreshDreamProviderActivity}
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

function SourceBadge({ source, isDefault }: { source?: string; isDefault?: boolean }) {
    const s = source || 'default';
    const variant =
        s === 'cli' ? 'ar-src-cli' :
            s === 'env' ? 'ar-src-env' :
                s === 'file' || s === 'config' ? 'ar-src-config' :
                    '';
    const modifiedClass = isDefault === false ? ' ar-src-modified' : '';
    const label = isDefault === false ? 'modified' : s;
    const title = isDefault === false
        ? `Value differs from the built-in default (source: ${s})`
        : `Source: ${s}`;
    return <span className={`ar-src ${variant}${modifiedClass}`.trim()} title={title}>{label}</span>;
}

/* ── Row primitives that produce the new visual without changing behaviour ── */

interface AdminRowProps {
    name: ReactNode;
    hint?: ReactNode;
    children: ReactNode;
    'data-testid'?: string;
}
function AdminRow({ name, hint, children, 'data-testid': dataTestId }: AdminRowProps) {
    return (
        <div className="ar-row" data-testid={dataTestId}>
            <div className="ar-label-block">
                <div className="ar-name">{name}</div>
                {hint && <div className="ar-hint">{hint}</div>}
            </div>
            <div className="ar-control">{children}</div>
        </div>
    );
}

interface AdminToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    'data-testid'?: string;
    'aria-label'?: string;
}
function AdminToggle({ checked, onChange, disabled, 'data-testid': dataTestId, 'aria-label': ariaLabel }: AdminToggleProps) {
    return (
        <label className="ar-toggle">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange(e.target.checked)}
                data-testid={dataTestId}
                aria-label={ariaLabel}
            />
            <span className="ar-track" />
            <span className="ar-knob" />
        </label>
    );
}

interface AdminSegOption<T extends string | number> {
    value: T;
    label: string;
    testId?: string;
}
interface AdminSegProps<T extends string | number> {
    value: T;
    onChange: (value: T) => void;
    options: ReadonlyArray<AdminSegOption<T>>;
    'aria-label'?: string;
}
function AdminSeg<T extends string | number>({ value, onChange, options, 'aria-label': ariaLabel }: AdminSegProps<T>) {
    return (
        <div className="ar-seg" role="group" aria-label={ariaLabel}>
            {options.map(opt => (
                <button
                    key={String(opt.value)}
                    type="button"
                    className={value === opt.value ? 'is-on' : ''}
                    aria-pressed={value === opt.value}
                    onClick={() => onChange(opt.value)}
                    data-testid={opt.testId}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

interface AdminInputSuffixProps {
    suffix: string;
    children: ReactNode;
}
function AdminInputSuffix({ suffix, children }: AdminInputSuffixProps) {
    return (
        <span className="ar-input-suffix">
            {children}
            <span className="ar-suffix">{suffix}</span>
        </span>
    );
}
