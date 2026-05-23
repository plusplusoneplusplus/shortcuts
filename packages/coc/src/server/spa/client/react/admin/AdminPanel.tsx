/**
 * AdminPanel — full admin page replacing vanilla admin.ts.
 * Storage stats, config view, export, import, and data wipe.
 *
 * Visuals are driven by `admin-redesign.css` (a Linear-inspired CSS layer
 * scoped under `.admin-redesign`). Behaviour, testids, and structure are
 * unchanged — only the look is updated.
 */

import './admin-redesign.css';
import { useState, useEffect, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { Spinner, useToast, ToastContainer } from '../ui';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';
import { invalidateHtmlEmbedPreference } from '../hooks/preferences/useHtmlEmbedPreference';
import { SettingsCard } from './SettingsCard';
import { ProviderTokensSection } from './ProviderTokensSection';
import { PromptsPanel } from './PromptsPanel';
import { DbBrowserSection } from './DbBrowserSection';
import { useApp } from '../contexts/AppContext';
import { FeatureTip } from '../welcome/FeatureTip';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import { useLinkHandlers } from '../hooks/useLinkHandlers';
import { getLinkHandlersMeta } from '../utils/link-handler';
import type { AdminSubTab, DashboardTab } from '../types/dashboard';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';
import { patchGlobalPreferences } from '../utils/preferencesApi';

import { isContainerMode, isServersEnabled } from '../utils/config';

const StorageSection = lazy(() => import('./StorageSection'));
const AgentManagementPanel = lazy(() => import('../repos/AgentManagementPanel').then(m => ({ default: m.AgentManagementPanel })));
const IMSettingsSection = lazy(() => import('./IMSettingsSection').then(m => ({ default: m.IMSettingsSection })));

// Tool views embedded in the admin right panel. Keeping the imports here
// (not in Router.tsx) means the admin shell owns their layout.
const SkillsView = lazy(() => import('../features/skills/SkillsView').then(m => ({ default: m.SkillsView })));
const LogsView = lazy(() => import('../features/logs/LogsView').then(m => ({ default: m.LogsView })));
const UsageStatsView = lazy(() => import('../features/stats/UsageStatsView').then(m => ({ default: m.UsageStatsView })));
const ModelsView = lazy(() => import('../features/models/ModelsView').then(m => ({ default: m.ModelsView })));
const ServersView = lazy(() => import('../features/servers/ServersView').then(m => ({ default: m.ServersView })));

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
const TAB_LABELS: Record<AdminSubTab, string> = { settings: 'Settings', providers: 'Providers', data: 'Data', server: 'Server', prompts: 'Prompts', database: 'Database', agents: 'Agents', messaging: 'Messaging' };
const TAB_ICONS: Record<AdminSubTab, string> = {
    settings: '⚙',
    providers: '◇',
    data: '▦',
    server: '⌗',
    prompts: '✎',
    database: '◫',
    agents: '◉',
    messaging: '✉',
};
const TAB_DESCRIPTIONS: Record<AdminSubTab, string> = {
    settings: 'Configure how this CoC server runs — model, chat, appearance, and feature flags.',
    providers: 'Manage credentials for GitHub, Azure DevOps, and other connected providers.',
    data: 'Storage backend, JSON import / export, and destructive cleanup actions.',
    server: 'Inspect the running CoC process, change its display name, or restart it.',
    prompts: 'Read-only view of the system prompts the assistant uses.',
    database: 'Browse the underlying SQLite tables that back CoC.',
    agents: 'Manage container-mode agents and their lifecycles.',
    messaging: 'Configure container messaging integrations (e.g. WhatsApp).',
};
// ── Settings sub-tabs (rendered as an underline tab row inside the
// Settings page, matching the Linear-style design reference). Each entry
// maps 1:1 to a `SettingsCard` further down. The current selection is
// kept in component state and synced to the URL fragment so refreshes
// land on the same section.
type SettingsSubTab = 'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'advanced';
const SETTINGS_SUBTABS: { id: SettingsSubTab; label: string; icon: string }[] = [
    { id: 'ai', label: 'AI & Execution', icon: '✦' },
    { id: 'chat', label: 'Chat', icon: '◌' },
    { id: 'appearance', label: 'Appearance', icon: '◐' },
    { id: 'features', label: 'Features', icon: '◫' },
    { id: 'integrations', label: 'Integrations', icon: '⇄' },
    { id: 'advanced', label: 'Advanced', icon: '⚙' },
];
const DEFAULT_SETTINGS_SUBTAB: SettingsSubTab = 'ai';
const VALID_SETTINGS_SUBTABS = new Set<SettingsSubTab>(SETTINGS_SUBTABS.map(t => t.id));

function parseSettingsSubTabFromHash(hash: string): SettingsSubTab | null {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'admin' || parts[1] !== 'settings') return null;
    const candidate = parts[2] as SettingsSubTab | undefined;
    return candidate && VALID_SETTINGS_SUBTABS.has(candidate) ? candidate : null;
}

const WELCOME_RESET_PROGRESS = { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false };

// ── Tools nav group (migrated from the topbar Tools dropdown). Each entry
// stays a top-level dashboard route (so deep links like `#skills` continue
// to work), but the corresponding view is now rendered **embedded** in the
// admin right panel instead of replacing the whole page. The Router maps
// these tabs to `<AdminPanel />` and AdminPanel switches on
// `state.activeTab` to mount the right view in `<main>`. Ids match the
// legacy dropdown so existing tests/deep-link selectors keep working.
interface ToolNavItem {
    id: string;
    tab: DashboardTab;
    label: string;
    icon: string;
    description: string;
}
const ALL_TOOL_NAV_ITEMS: ToolNavItem[] = [
    { id: 'skills-toggle',  tab: 'skills',  label: 'Skills',  icon: '⚡', description: 'Install, configure, and inspect agent skills surfaced to the assistant.' },
    { id: 'logs-toggle',    tab: 'logs',    label: 'Logs',    icon: '📋', description: 'Live and historical server logs streamed via SSE.' },
    { id: 'stats-toggle',   tab: 'stats',   label: 'Usage',   icon: '📊', description: 'Aggregated usage statistics for chats, tokens, and processes.' },
    { id: 'models-toggle',  tab: 'models',  label: 'Models',  icon: '⚛', description: 'Available LLM models and their per-repo defaults.' },
    { id: 'servers-toggle', tab: 'servers', label: 'Servers', icon: '🖥', description: 'Browse running CoC server instances and their health.' },
];
const TOOL_TAB_SET: ReadonlySet<DashboardTab> = new Set<DashboardTab>(ALL_TOOL_NAV_ITEMS.map(item => item.tab));
const TOOL_NAV_LOOKUP: ReadonlyMap<DashboardTab, ToolNavItem> = new Map(ALL_TOOL_NAV_ITEMS.map(item => [item.tab, item]));

export function AdminPanel() {
    const { toasts, addToast, removeToast } = useToast();
    const { state, dispatch } = useApp();
    const { updateOnboarding } = useOnboardingPreferences();
    const activeTab = state.activeAdminSubTab;
    // `state.activeTab` is the dashboard-level route. When set to a tool
    // route (skills/logs/stats/models/servers) the right panel hosts the
    // corresponding view embedded inside the admin shell.
    const activeDashboardTab = state.activeTab;
    const activeToolItem = TOOL_NAV_LOOKUP.get(activeDashboardTab) ?? null;
    const isToolEmbedded = activeToolItem !== null;
    const handleTabChange = (tab: AdminSubTab) => {
        dispatch({ type: 'SET_ADMIN_SUB_TAB', tab });
        // Configure rows always land on the admin shell — make sure the
        // dashboard tab leaves any embedded tool view.
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'admin' });
        const suffix = tab === 'settings' && settingsSubTab !== DEFAULT_SETTINGS_SUBTAB
            ? `admin/${tab}/${settingsSubTab}`
            : `admin/${tab}`;
        window.location.hash = suffix;
    };

    // Settings sub-tab (only meaningful when activeTab === 'settings'). The
    // initial value is derived from the URL so refreshing on
    // `#admin/settings/<sub>` lands on the same section.
    const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>(() => {
        if (typeof window === 'undefined') return DEFAULT_SETTINGS_SUBTAB;
        return parseSettingsSubTabFromHash(window.location.hash) ?? DEFAULT_SETTINGS_SUBTAB;
    });
    const handleSettingsSubTabChange = (sub: SettingsSubTab) => {
        setSettingsSubTab(sub);
        const suffix = sub === DEFAULT_SETTINGS_SUBTAB ? 'admin/settings' : `admin/settings/${sub}`;
        window.location.hash = suffix;
    };

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
            void updateOnboarding({ settingsVisited: true }).catch(() => {});
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
    const [terminalEnabled, setTerminalEnabled] = useState(true);
    const [notesEnabled, setNotesEnabled] = useState(true);
    const [myWorkEnabled, setMyWorkEnabled] = useState(false);
    const [myLifeEnabled, setMyLifeEnabled] = useState(false);
    const [scratchpadEnabled, setScratchpadEnabled] = useState(false);
    const [scratchpadLayout, setScratchpadLayout] = useState<'horizontal' | 'vertical'>('horizontal');
    const [workflowsEnabled, setWorkflowsEnabled] = useState(false);
    const [pullRequestsEnabled, setPullRequestsEnabled] = useState(false);
    const [pullRequestsSuggestionsEnabled, setPullRequestsSuggestionsEnabled] = useState(false);
    const [serversEnabled, setServersEnabled] = useState(false);
    const [ralphEnabled, setRalphEnabled] = useState(false);
    const [vimNavigationEnabled, setVimNavigationEnabled] = useState(false);
    const [loopsEnabled, setLoopsEnabled] = useState(false);
    const [excalidrawEnabled, setExcalidrawEnabled] = useState(false);
    const [mcpOauthEnabled, setMcpOauthEnabled] = useState(false);
    const [focusedDiffEnabled, setFocusedDiffEnabled] = useState(false);
    const [codexEnabled, setCodexEnabled] = useState(false);
    const [activeProvider, setActiveProvider] = useState<'copilot' | 'codex'>('copilot');
    const [providerAvailability, setProviderAvailability] = useState<Record<string, { available: boolean; error?: string }>>({});

    // Preferences(theme, reposSidebarCollapsed, uiLayoutMode) — for Appearance card
    const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
    const [reposSidebarCollapsed, setReposSidebarCollapsed] = useState(false);
    const [uiLayoutMode, setUiLayoutMode] = useState<'classic' | 'dev-workflow'>('classic');
    const [htmlEmbedEnabled, setHtmlEmbedEnabled] = useState(true);
    const [promptAutocompleteEnabled, setPromptAutocompleteEnabled] = useState(true);
    const [promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled] = useState(false);

    // Link handlers — shared module-level state via hook
    const [linkHandlersConfig, setHandlerEnabled] = useLinkHandlers();

    // Per-card saving state
    const [aiExecSaving, setAiExecSaving] = useState(false);
    const [chatSaving, setChatSaving] = useState(false);
    const [appearanceSaving, setAppearanceSaving] = useState(false);
    const [featuresSaving, setFeaturesSaving] = useState(false);
    const [activeProviderSaving, setActiveProviderSaving] = useState(false);

    // Snapshots for per-card dirty tracking (set when config/prefs loads)
    const [aiExecSnapshot, setAiExecSnapshot] = useState({ model: '', parallel: '1', timeout: '', output: 'table' });
    const [activeProviderSnapshot, setActiveProviderSnapshot] = useState<'copilot' | 'codex'>('copilot');
    const [chatSnapshot, setChatSnapshot] = useState({ followUpEnabled: true, followUpCount: '3', askUserEnabled: false, showReportIntent: false, toolCompactness: 3 as 0 | 1 | 2 | 3 });
    const [appearanceSnapshot, setAppearanceSnapshot] = useState({
        theme: 'auto' as string,
        reposSidebarCollapsed: false,
        uiLayoutMode: 'classic' as string,
        htmlEmbedEnabled: true,
        promptAutocompleteEnabled: true,
        promptAutocompleteAiEnabled: false,
        taskCardDensity: 'compact' as 'compact' | 'dense',
        historyGrouping: true,
    });
    const [featuresSnapshot, setFeaturesSnapshot] = useState({ terminal: true, notes: true, myWork: false, myLife: false, scratchpad: false, scratchpadLayout: 'horizontal' as 'horizontal' | 'vertical', workflows: false, pullRequests: false, pullRequestsSuggestions: false, servers: false, ralph: false, vimNavigation: false, loops: false, excalidraw: false, mcpOauth: false, focusedDiff: false, codexEnabled: false });

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
            const te = resolved.terminal?.enabled ?? true;
            const ne = resolved.notes?.enabled ?? false;
            const mwe = resolved.myWork?.enabled ?? false;
            const mle = resolved.myLife?.enabled ?? false;
            setTerminalEnabled(te);
            setNotesEnabled(ne);
            setMyWorkEnabled(mwe);
            setMyLifeEnabled(mle);
            const se = resolved.scratchpad?.enabled ?? false;
            setScratchpadEnabled(se);
            const sl = (resolved.scratchpad?.layout === 'vertical' ? 'vertical' : 'horizontal') as 'horizontal' | 'vertical';
            setScratchpadLayout(sl);
            const we = resolved.workflows?.enabled ?? false;
            setWorkflowsEnabled(we);
            const pre = resolved.pullRequests?.enabled ?? false;
            setPullRequestsEnabled(pre);
            const prse = resolved.pullRequests?.suggestions ?? false;
            setPullRequestsSuggestionsEnabled(prse);
            const svre = resolved.servers?.enabled ?? false;
            setServersEnabled(svre);
            const re = resolved.ralph?.enabled ?? false;
            setRalphEnabled(re);
            const vne = resolved.vimNavigation?.enabled ?? false;
            setVimNavigationEnabled(vne);
            const loe = resolved.loops?.enabled ?? false;
            setLoopsEnabled(loe);
            const exe = resolved.excalidraw?.enabled ?? false;
            setExcalidrawEnabled(exe);
            const moae = resolved.mcpOauth?.enabled ?? false;
            setMcpOauthEnabled(moae);
            const fde = resolved.features?.focusedDiff ?? false;
            setFocusedDiffEnabled(fde);
            const cxe = resolved.codex?.enabled ?? false;
            setCodexEnabled(cxe);
            const ap = (resolved.activeProvider === 'codex' ? 'codex' : 'copilot') as 'copilot' | 'codex';
            setActiveProvider(ap);
            setFeaturesSnapshot({ terminal: te, notes: ne, myWork: mwe, myLife: mle, scratchpad: se, scratchpadLayout: sl, workflows: we, pullRequests: pre, pullRequestsSuggestions: prse, servers: svre, ralph: re, vimNavigation: vne, loops: loe, excalidraw: exe, mcpOauth: moae, focusedDiff: fde, codexEnabled: cxe });
            setAiExecSnapshot({ model: form.model, parallel: form.parallel, timeout: form.timeout, output: form.output });
            setActiveProviderSnapshot(ap);
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
            const pae = data.promptAutocomplete?.enabled !== false;
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

    useEffect(() => {
        loadStats();
        loadConfig();
        loadPreferences();
        getSpaCocClient().admin.getVersion()
            .then(data => { if (data) setVersionInfo(data); })
            .catch(() => {});
        fetch('/api/admin/providers/availability')
            .then(r => r.json())
            .then((data: Record<string, { available: boolean; error?: string }>) => setProviderAvailability(data))
            .catch(() => {});
    }, [loadStats, loadConfig, loadPreferences]);

    // ── Per-card dirty state ──
    const aiExecDirty = configForm.model !== aiExecSnapshot.model ||
        configForm.parallel !== aiExecSnapshot.parallel ||
        configForm.timeout !== aiExecSnapshot.timeout ||
        configForm.output !== aiExecSnapshot.output;

    const activeProviderDirty = activeProvider !== activeProviderSnapshot;

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

    const featuresDirty = terminalEnabled !== featuresSnapshot.terminal ||
        notesEnabled !== featuresSnapshot.notes ||
        myWorkEnabled !== featuresSnapshot.myWork ||
        myLifeEnabled !== featuresSnapshot.myLife ||
        scratchpadEnabled !== featuresSnapshot.scratchpad ||
        scratchpadLayout !== featuresSnapshot.scratchpadLayout ||
        workflowsEnabled !== featuresSnapshot.workflows ||
        pullRequestsEnabled !== featuresSnapshot.pullRequests ||
        pullRequestsSuggestionsEnabled !== featuresSnapshot.pullRequestsSuggestions ||
        serversEnabled !== featuresSnapshot.servers ||
        ralphEnabled !== featuresSnapshot.ralph ||
        vimNavigationEnabled !== featuresSnapshot.vimNavigation ||
        loopsEnabled !== featuresSnapshot.loops ||
        excalidrawEnabled !== featuresSnapshot.excalidraw ||
        mcpOauthEnabled !== featuresSnapshot.mcpOauth ||
        focusedDiffEnabled !== featuresSnapshot.focusedDiff ||
        codexEnabled !== featuresSnapshot.codexEnabled;

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

    // ── Active Provider card (Agents tab) ──
    const handleSaveActiveProvider = useCallback(async () => {
        setActiveProviderSaving(true);
        try {
            await getSpaCocClient().admin.updateConfig({ activeProvider });
            addToast('Active provider saved — restart required to apply change', 'success');
            setActiveProviderSnapshot(activeProvider);
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setActiveProviderSaving(false);
        }
    }, [activeProvider, addToast]);

    const handleCancelActiveProvider = useCallback(() => {
        setActiveProvider(activeProviderSnapshot);
    }, [activeProviderSnapshot]);

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
            await getSpaCocClient().admin.updateConfig({
                'terminal.enabled': terminalEnabled,
                'notes.enabled': notesEnabled,
                'myWork.enabled': myWorkEnabled,
                'myLife.enabled': myLifeEnabled,
                'scratchpad.enabled': scratchpadEnabled,
                'scratchpad.layout': scratchpadLayout,
                'workflows.enabled': workflowsEnabled,
                'pullRequests.enabled': pullRequestsEnabled,
                'pullRequests.suggestions': pullRequestsSuggestionsEnabled,
                'servers.enabled': serversEnabled,
                'ralph.enabled': ralphEnabled,
                'vimNavigation.enabled': vimNavigationEnabled,
                'loops.enabled': loopsEnabled,
                'excalidraw.enabled': excalidrawEnabled,
                'mcpOauth.enabled': mcpOauthEnabled,
                'features.focusedDiff': focusedDiffEnabled,
                'codex.enabled': codexEnabled,
            });
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            setFeaturesSnapshot({ terminal: terminalEnabled, notes: notesEnabled, myWork: myWorkEnabled, myLife: myLifeEnabled, scratchpad: scratchpadEnabled, scratchpadLayout: scratchpadLayout, workflows: workflowsEnabled, pullRequests: pullRequestsEnabled, pullRequestsSuggestions: pullRequestsSuggestionsEnabled, servers: serversEnabled, ralph: ralphEnabled, vimNavigation: vimNavigationEnabled, loops: loopsEnabled, excalidraw: excalidrawEnabled, mcpOauth: mcpOauthEnabled, focusedDiff: focusedDiffEnabled, codexEnabled: codexEnabled });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setFeaturesSaving(false);
        }
    }, [terminalEnabled, notesEnabled, myWorkEnabled, myLifeEnabled, scratchpadEnabled, scratchpadLayout, workflowsEnabled, pullRequestsEnabled, pullRequestsSuggestionsEnabled, serversEnabled, ralphEnabled, vimNavigationEnabled, loopsEnabled, excalidrawEnabled, mcpOauthEnabled, focusedDiffEnabled, codexEnabled, addToast]);

    const handleCancelFeatures = useCallback(() => {
        setTerminalEnabled(featuresSnapshot.terminal);
        setNotesEnabled(featuresSnapshot.notes);
        setMyWorkEnabled(featuresSnapshot.myWork);
        setMyLifeEnabled(featuresSnapshot.myLife);
        setScratchpadEnabled(featuresSnapshot.scratchpad);
        setScratchpadLayout(featuresSnapshot.scratchpadLayout);
        setWorkflowsEnabled(featuresSnapshot.workflows);
        setPullRequestsEnabled(featuresSnapshot.pullRequests);
        setPullRequestsSuggestionsEnabled(featuresSnapshot.pullRequestsSuggestions);
        setServersEnabled(featuresSnapshot.servers);
        setRalphEnabled(featuresSnapshot.ralph);
        setVimNavigationEnabled(featuresSnapshot.vimNavigation);
        setLoopsEnabled(featuresSnapshot.loops);
        setExcalidrawEnabled(featuresSnapshot.excalidraw);
        setMcpOauthEnabled(featuresSnapshot.mcpOauth);
        setFocusedDiffEnabled(featuresSnapshot.focusedDiff);
        setCodexEnabled(featuresSnapshot.codexEnabled);
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

    const handleExport= useCallback(async () => {
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

    const baseTabs: AdminSubTab[] = ['settings', 'providers', 'data', 'server', 'prompts', 'database'];
    const tabs: AdminSubTab[] = isContainerMode() ? [...baseTabs, 'agents', 'messaging'] : [...baseTabs, 'agents'];

    // Servers row is gated by the dashboard runtime config, same source the
    // legacy topbar dropdown consulted. It is independent of the editable
    // `serversEnabled` Features form state above.
    const toolNavItems: ToolNavItem[] = isServersEnabled()
        ? ALL_TOOL_NAV_ITEMS
        : ALL_TOOL_NAV_ITEMS.filter(item => item.tab !== 'servers');

    const handleToolNavClick = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        window.location.hash = '#' + tab;
    }, [dispatch]);

    const activeTabLabel = TAB_LABELS[activeTab];

    return (
        <div id="view-admin" className="admin-redesign">
            <div id="admin-page-content" className="ar-shell">
                {/* ── Sidebar ── */}
                <aside className="ar-sidebar" aria-label="Admin sections">
                    <div className="ar-brand">
                        <div className="ar-brand-logo" aria-hidden="true" />
                        <div className="ar-brand-text">
                            <span className="ar-brand-name">CoC Admin</span>
                            <span className="ar-brand-sub">{versionInfo?.version ? `v${versionInfo.version}` : 'Local server'}</span>
                        </div>
                    </div>

                    <nav className="ar-nav-group" aria-label="Settings sections">
                        <div className="ar-nav-group-label">Configure</div>
                        {tabs.map(tab => {
                            // Configure rows are only "active" when the dashboard
                            // is on the admin shell — an embedded tool view should
                            // not show any Configure row as the current page.
                            const isActive = !isToolEmbedded && activeTab === tab;
                            return (
                                <button
                                    key={tab}
                                    type="button"
                                    className={`ar-nav-item${isActive ? ' is-active' : ''}`}
                                    onClick={() => handleTabChange(tab)}
                                    data-testid={`admin-tab-${tab}`}
                                    aria-current={isActive ? 'page' : undefined}
                                >
                                    <span className="ar-nav-icon" aria-hidden="true">{TAB_ICONS[tab]}</span>
                                    <span className="ar-nav-label">{TAB_LABELS[tab]}</span>
                                </button>
                            );
                        })}
                    </nav>

                    <nav className="ar-nav-group" aria-label="Tools">
                        <div className="ar-nav-group-label">Tools</div>
                        {toolNavItems.map(item => {
                            const isActive = activeDashboardTab === item.tab;
                            return (
                                <button
                                    key={item.id}
                                    id={item.id}
                                    type="button"
                                    className={`ar-nav-item${isActive ? ' is-active' : ''}`}
                                    onClick={() => handleToolNavClick(item.tab)}
                                    data-testid={item.id}
                                    data-tab={item.tab}
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

                    <div className="ar-sidebar-foot">
                        <div className="ar-stats-block">
                            <div className="ar-stats-head">
                                <span>Usage</span>
                                <button
                                    id="admin-refresh-stats"
                                    type="button"
                                    onClick={loadStats}
                                    title="Refresh stats"
                                    className="ar-stats-refresh"
                                    aria-label="Refresh stats"
                                >↻</button>
                            </div>
                            {statsLoading ? (
                                <Spinner size="sm" />
                            ) : (
                                <>
                                    <div className="ar-stat-row" data-testid="stat-processes">
                                        <span className="ar-stat-label">Processes</span>
                                        <span className="ar-stat-value">{stats?.processCount ?? '—'}</span>
                                    </div>
                                    <div className="ar-stat-row" data-testid="stat-wikis">
                                        <span className="ar-stat-label">Wikis</span>
                                        <span className="ar-stat-value">{stats?.wikiCount ?? '—'}</span>
                                    </div>
                                    <div className="ar-stat-row" data-testid="stat-disk">
                                        <span className="ar-stat-label">Disk</span>
                                        <span className="ar-stat-value">{stats?.totalBytes != null ? formatBytes(stats.totalBytes) : '—'}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </aside>

                {/* ── Main pane ── */}
                <main className={`ar-main${isToolEmbedded ? ' ar-main--embed' : ''}`}>
                    <header className="ar-topbar">
                        <nav className="ar-breadcrumb" aria-label="Breadcrumb">
                            {isToolEmbedded && activeToolItem ? (
                                <>
                                    <span className="ar-crumb">Tools</span>
                                    <span className="ar-crumb-sep">/</span>
                                    <span className="ar-crumb-now">{activeToolItem.label}</span>
                                </>
                            ) : (
                                <>
                                    <span className="ar-crumb-now">{activeTabLabel}</span>
                                    {activeTab === 'settings' && (
                                        <>
                                            <span className="ar-crumb-sep">/</span>
                                            <span className="ar-crumb-now">
                                                {SETTINGS_SUBTABS.find(t => t.id === settingsSubTab)?.label ?? activeTabLabel}
                                            </span>
                                        </>
                                    )}
                                </>
                            )}
                        </nav>
                        {!isToolEmbedded && (
                            <select
                                className="ar-tab-select ar-mobile-tab-select"
                                value={activeTab}
                                onChange={e => handleTabChange(e.target.value as AdminSubTab)}
                                aria-label="Select admin section"
                            >
                                {tabs.map(tab => (
                                    <option key={tab} value={tab}>{TAB_LABELS[tab]}</option>
                                ))}
                            </select>
                        )}
                    </header>

                    {isToolEmbedded && activeToolItem ? (
                        <div className="ar-tool-embed" data-testid={`admin-tool-embed-${activeToolItem.tab}`}>
                            <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                                {activeToolItem.tab === 'skills' && <SkillsView />}
                                {activeToolItem.tab === 'logs' && <LogsView />}
                                {activeToolItem.tab === 'stats' && <UsageStatsView />}
                                {activeToolItem.tab === 'models' && <ModelsView />}
                                {activeToolItem.tab === 'servers' && <ServersView />}
                            </Suspense>
                        </div>
                    ) : (
                    <div className="ar-page">
                        <header className="ar-page-header">
                            <div className="ar-page-header-row">
                                <div>
                                    <p className="ar-page-desc">{TAB_DESCRIPTIONS[activeTab]}</p>
                                </div>
                            </div>
                        </header>

                        <FeatureTip tipId="admin-intro" />

                        {/* ── Settings tab ── */}
                {activeTab === 'settings' && (
                    <div className="space-y-3" data-testid="settings-cards">
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
                                <div className="ar-subtab-row" role="tablist" aria-label="Settings sections">
                                    {SETTINGS_SUBTABS.map(sub => (
                                        <button
                                            key={sub.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={settingsSubTab === sub.id}
                                            className={`ar-subtab${settingsSubTab === sub.id ? ' is-active' : ''}`}
                                            onClick={() => handleSettingsSubTabChange(sub.id)}
                                            data-testid={`settings-subtab-${sub.id}`}
                                        >
                                            <span className="ar-subtab-icon" aria-hidden="true">{sub.icon}</span>
                                            {sub.label}
                                        </button>
                                    ))}
                                </div>

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
                                        <SourceBadge source={sources['model']} />
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
                                        <SourceBadge source={sources['parallel']} />
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
                                        <SourceBadge source={sources['timeout']} />
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
                                        <SourceBadge source={sources['output']} />
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
                                        <SourceBadge source={sources['chat.followUpSuggestions.enabled']} />
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
                                        <SourceBadge source={sources['chat.followUpSuggestions.count']} />
                                    </AdminRow>
                                    <AdminRow
                                        name="Ask user (interactive questions)"
                                        hint="Allow the AI to pause and ask the user a question mid-task instead of guessing."
                                    >
                                        <SourceBadge source={sources['chat.askUser.enabled']} />
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
                                        <SourceBadge source={sources['showReportIntent']} />
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
                                        <SourceBadge source={sources['toolCompactness']} />
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
                                        <SourceBadge source={sources['taskCardDensity']} />
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
                                        <SourceBadge source={sources['historyGrouping']} />
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
                                    <AdminRow name={<>Terminal <span className="ar-badge ar-badge-warning">Restart</span></>} hint="Web terminal for shell access to the server machine. Toggling requires a server restart.">
                                        <SourceBadge source={sources['terminal.enabled']} />
                                        <AdminToggle checked={terminalEnabled} onChange={setTerminalEnabled} data-testid="toggle-terminal-enabled" />
                                    </AdminRow>
                                    <AdminRow name="Notes" hint="Markdown notebooks for creating and editing notes.">
                                        <SourceBadge source={sources['notes.enabled']} />
                                        <AdminToggle checked={notesEnabled} onChange={setNotesEnabled} data-testid="toggle-notes-enabled" />
                                    </AdminRow>
                                    <AdminRow name="My Work" hint="Personal landing page with action items and weekly summaries.">
                                        <SourceBadge source={sources['myWork.enabled']} />
                                        <AdminToggle checked={myWorkEnabled} onChange={setMyWorkEnabled} data-testid="toggle-mywork-enabled" />
                                    </AdminRow>
                                    <AdminRow name="My Life" hint="Personal page with goals, journal, and life admin.">
                                        <SourceBadge source={sources['myLife.enabled']} />
                                        <AdminToggle checked={myLifeEnabled} onChange={setMyLifeEnabled} data-testid="toggle-mylife-enabled" />
                                    </AdminRow>
                                    <AdminRow name="Scratchpad panel" hint="Bottom-split note editor inside the chat detail view.">
                                        <SourceBadge source={sources['scratchpad.enabled']} />
                                        <AdminToggle checked={scratchpadEnabled} onChange={setScratchpadEnabled} data-testid="toggle-scratchpad-enabled" />
                                    </AdminRow>
                                    {scratchpadEnabled && (
                                        <AdminRow name="Layout" hint="Split direction for conversation and scratchpad.">
                                            <SourceBadge source={sources['scratchpad.layout']} />
                                            <select
                                                className="ar-select ar-med"
                                                value={scratchpadLayout}
                                                onChange={e => setScratchpadLayout(e.target.value as 'horizontal' | 'vertical')}
                                                data-testid="select-scratchpad-layout"
                                            >
                                                <option value="horizontal">Horizontal (top/bottom)</option>
                                                <option value="vertical">Vertical (left/right)</option>
                                            </select>
                                        </AdminRow>
                                    )}
                                    <AdminRow name="Workflows Tab" hint="YAML workflow runner tab in repo view.">
                                        <SourceBadge source={sources['workflows.enabled']} />
                                        <AdminToggle checked={workflowsEnabled} onChange={setWorkflowsEnabled} data-testid="toggle-workflows-enabled" />
                                    </AdminRow>
                                    <AdminRow name="Pull Requests Tab" hint="Pull request list tab in repo view.">
                                        <SourceBadge source={sources['pullRequests.enabled']} />
                                        <AdminToggle checked={pullRequestsEnabled} onChange={setPullRequestsEnabled} data-testid="toggle-pull-requests-enabled" />
                                    </AdminRow>
                                    {pullRequestsEnabled && (
                                        <AdminRow name="PR Review Suggestions" hint="AI-ranked suggestions for which open PRs to review, based on your review history. Adds a 'For You' filter pill to the PR queue.">
                                            <SourceBadge source={sources['pullRequests.suggestions']} />
                                            <AdminToggle checked={pullRequestsSuggestionsEnabled} onChange={setPullRequestsSuggestionsEnabled} data-testid="toggle-pull-requests-suggestions-enabled" />
                                        </AdminRow>
                                    )}
                                    <AdminRow name="Servers" hint="Multi-server connection manager (devtunnel).">
                                        <SourceBadge source={sources['servers.enabled']} />
                                        <AdminToggle checked={serversEnabled} onChange={setServersEnabled} data-testid="toggle-servers-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name={<>Ralph Mode <span className="ar-badge ar-badge-accent">Experimental</span></>}
                                        hint="Autonomous iterative coding loop — stateless agents with fresh context per iteration."
                                    >
                                        <SourceBadge source={sources['ralph.enabled']} />
                                        <AdminToggle checked={ralphEnabled} onChange={setRalphEnabled} data-testid="toggle-ralph-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name="Vim-style navigation"
                                        hint="Enable hjkl pane navigation, j/k to step through chats and messages, gg/G to jump, i to focus the input, Esc to blur. Disabled by default."
                                    >
                                        <SourceBadge source={sources['vimNavigation.enabled']} />
                                        <AdminToggle checked={vimNavigationEnabled} onChange={setVimNavigationEnabled} data-testid="toggle-vim-navigation-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name={<>Loops &amp; Wakeups <span className="ar-badge ar-badge-warning">Restart</span></>}
                                        hint="Recurring follow-up loops and one-shot scheduleWakeup tool. Disabled by default — toggling requires a server restart to (de)wire infrastructure."
                                    >
                                        <SourceBadge source={sources['loops.enabled']} />
                                        <AdminToggle checked={loopsEnabled} onChange={setLoopsEnabled} data-testid="toggle-loops-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name="Excalidraw diagrams"
                                        hint="AI can generate and read Excalidraw diagrams during conversations. Disabled by default."
                                    >
                                        <SourceBadge source={sources['excalidraw.enabled']} />
                                        <AdminToggle checked={excalidrawEnabled} onChange={setExcalidrawEnabled} data-testid="toggle-excalidraw-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name={<>MCP OAuth <span className="ar-badge ar-badge-warning">Restart</span></>}
                                        hint="Handle OAuth flows for MCP servers that require authentication. Disabled by default — toggling requires a server restart."
                                    >
                                        <SourceBadge source={sources['mcpOauth.enabled']} />
                                        <AdminToggle checked={mcpOauthEnabled} onChange={setMcpOauthEnabled} data-testid="toggle-mcp-oauth-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name={<>Codex Provider <span className="ar-badge ar-badge-accent">Experimental</span> <span className="ar-badge ar-badge-warning">Restart</span></>}
                                        hint="Enable the optional @openai/codex-sdk provider. Once enabled, switch the active provider in the AI & Execution tab. Requires a server restart."
                                    >
                                        <SourceBadge source={sources['codex.enabled']} />
                                        <AdminToggle checked={codexEnabled} onChange={setCodexEnabled} data-testid="toggle-codex-enabled" />
                                    </AdminRow>
                                    <AdminRow
                                        name="Focused Diff"
                                        hint="AI-powered hunk classification for PR diffs. Highlights logic changes and dims mechanical edits."
                                    >
                                        <SourceBadge source={sources['features.focusedDiff']} />
                                        <AdminToggle checked={focusedDiffEnabled} onChange={setFocusedDiffEnabled} data-testid="toggle-focused-diff-enabled" />
                                    </AdminRow>
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
                                        <SourceBadge source={sources['approvePermissions']} />
                                    </AdminRow>
                                    <AdminRow name="MCP Config" hint="Path to the MCP servers config loaded at startup.">
                                        <span className="ar-mono ar-muted" style={{ fontSize: 12.5 }}>{String(resolved.mcpConfig ?? '—')}</span>
                                        <SourceBadge source={sources['mcpConfig']} />
                                    </AdminRow>
                                    <AdminRow name="Persist" hint="Whether sessions are persisted to disk.">
                                        <span className="ar-mono ar-muted" style={{ fontSize: 12.5 }}>{String(resolved.persist ?? '—')}</span>
                                        <SourceBadge source={sources['persist']} />
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

                {/* ── Providers tab ── */}
                {activeTab === 'providers' && (
                    <section className="ar-card" data-testid="provider-tokens-section">
                        <div style={{ padding: 4 }}>
                            <ProviderTokensSection
                                onError={msg => addToast(msg, 'error')}
                                onSuccess={msg => addToast(msg, 'success')}
                            />
                        </div>
                    </section>
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
                                    <SourceBadge source={sources['serve.serverName']} />
                                    <button id="admin-server-name-save" type="button" className="ar-btn ar-btn-primary ar-btn-sm" onClick={handleSaveServerName}>Save</button>
                                </AdminRow>
                            </div>
                        </section>

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

                        {activeTab === 'agents' && (
                            <>
                                <SettingsCard
                                    title="Active Provider"
                                    description="AI provider used for all chat and task requests."
                                    dirty={activeProviderDirty}
                                    saving={activeProviderSaving}
                                    onSave={handleSaveActiveProvider}
                                    onCancel={handleCancelActiveProvider}
                                    data-testid="settings-active-provider"
                                >
                                    <AdminRow
                                        name={<>Active Provider <span className="ar-badge ar-badge-warning">Restart</span></>}
                                        hint="Switch to 'Codex' only after enabling the Codex feature flag in Settings → Features and completing ChatGPT sign-in. Requires a server restart."
                                    >
                                        <select
                                            id="admin-config-active-provider"
                                            className="ar-select ar-med"
                                            value={activeProvider}
                                            onChange={e => setActiveProvider(e.target.value as 'copilot' | 'codex')}
                                            data-testid="select-active-provider"
                                        >
                                            <option value="copilot">Copilot</option>
                                            <option value="codex">Codex</option>
                                        </select>
                                        <SourceBadge source={sources['activeProvider']} />
                                    </AdminRow>
                                    {activeProvider === 'codex' && providerAvailability['codex'] && !providerAvailability['codex'].available && (
                                        <div
                                            data-testid="codex-sdk-unavailable-banner"
                                            style={{
                                                margin: '8px 0 4px',
                                                padding: '8px 12px',
                                                borderRadius: 4,
                                                background: 'var(--ar-warn-bg, #fffbe6)',
                                                border: '1px solid var(--ar-warn-border, #ffe58f)',
                                                color: 'var(--ar-warn-text, #7c5200)',
                                                fontSize: 12,
                                                lineHeight: 1.5,
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'inherit',
                                            }}
                                        >
                                            ⚠ {providerAvailability['codex'].error}
                                        </div>
                                    )}
                                    </AdminRow>
                                </SettingsCard>
                                {isContainerMode() && (
                                    <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                                        <AgentManagementPanel />
                                    </Suspense>
                                )}
                            </>
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

function SourceBadge({ source }: { source?: string }) {
    const s = source || 'default';
    const variant =
        s === 'cli' ? 'ar-src-cli' :
        s === 'env' ? 'ar-src-env' :
        s === 'file' || s === 'config' ? 'ar-src-config' :
        '';
    return <span className={`ar-src ${variant}`.trim()} title={`Source: ${s}`}>{s}</span>;
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
