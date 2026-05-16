/**
 * AdminPanel — full admin page replacing vanilla admin.ts.
 * Storage stats, config view, export, import, and data wipe.
 */

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Card, Button, Spinner, useToast, ToastContainer } from '../ui';
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
import type { AdminSubTab } from '../types/dashboard';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';
import { patchGlobalPreferences } from '../utils/preferencesApi';

import { isContainerMode } from '../utils/config';

const StorageSection = lazy(() => import('./StorageSection'));
const AgentManagementPanel = lazy(() => import('../repos/AgentManagementPanel').then(m => ({ default: m.AgentManagementPanel })));

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
const TAB_LABELS: Record<AdminSubTab, string> = { settings: 'Settings', providers: 'Providers', data: 'Data', server: 'Server', prompts: 'Prompts', database: 'Database', agents: 'Agents' };
const WELCOME_RESET_PROGRESS = { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false };

export function AdminPanel() {
    const { toasts, addToast, removeToast } = useToast();
    const { state, dispatch } = useApp();
    const { updateOnboarding } = useOnboardingPreferences();
    const activeTab = state.activeAdminSubTab;
    const handleTabChange = (tab: AdminSubTab) => {
        dispatch({ type: 'SET_ADMIN_SUB_TAB', tab });
        window.location.hash = `admin/${tab}`;
    };

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
    const [serversEnabled, setServersEnabled] = useState(false);
    const [ralphEnabled, setRalphEnabled] = useState(false);
    const [vimNavigationEnabled, setVimNavigationEnabled] = useState(false);
    const [loopsEnabled, setLoopsEnabled] = useState(false);
    const [focusedDiffEnabled, setFocusedDiffEnabled] = useState(false);

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

    // Snapshots for per-card dirty tracking (set when config/prefs loads)
    const [aiExecSnapshot, setAiExecSnapshot] = useState({ model: '', parallel: '1', timeout: '', output: 'table' });
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
    const [featuresSnapshot, setFeaturesSnapshot] = useState({ terminal: true, notes: true, myWork: false, myLife: false, scratchpad: false, scratchpadLayout: 'horizontal' as 'horizontal' | 'vertical', workflows: false, pullRequests: false, servers: false, ralph: false, vimNavigation: false, loops: false, focusedDiff: false });

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
            setAiExecSnapshot({ ...form });
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
            const svre = resolved.servers?.enabled ?? false;
            setServersEnabled(svre);
            const re = resolved.ralph?.enabled ?? false;
            setRalphEnabled(re);
            const vne = resolved.vimNavigation?.enabled ?? false;
            setVimNavigationEnabled(vne);
            const loe = resolved.loops?.enabled ?? false;
            setLoopsEnabled(loe);
            const fde = resolved.features?.focusedDiff ?? false;
            setFocusedDiffEnabled(fde);
            setFeaturesSnapshot({ terminal: te, notes: ne, myWork: mwe, myLife: mle, scratchpad: se, scratchpadLayout: sl, workflows: we, pullRequests: pre, servers: svre, ralph: re, vimNavigation: vne, loops: loe, focusedDiff: fde });
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
    }, [loadStats, loadConfig, loadPreferences]);

    // ── Per-card dirty state ──
    const aiExecDirty = configForm.model !== aiExecSnapshot.model ||
        configForm.parallel !== aiExecSnapshot.parallel ||
        configForm.timeout !== aiExecSnapshot.timeout ||
        configForm.output !== aiExecSnapshot.output;

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
        serversEnabled !== featuresSnapshot.servers ||
        ralphEnabled !== featuresSnapshot.ralph ||
        vimNavigationEnabled !== featuresSnapshot.vimNavigation ||
        loopsEnabled !== featuresSnapshot.loops ||
        focusedDiffEnabled !== featuresSnapshot.focusedDiff;

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
                'servers.enabled': serversEnabled,
                'ralph.enabled': ralphEnabled,
                'vimNavigation.enabled': vimNavigationEnabled,
                'loops.enabled': loopsEnabled,
                'features.focusedDiff': focusedDiffEnabled,
            });
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            setFeaturesSnapshot({ terminal: terminalEnabled, notes: notesEnabled, myWork: myWorkEnabled, myLife: myLifeEnabled, scratchpad: scratchpadEnabled, scratchpadLayout: scratchpadLayout, workflows: workflowsEnabled, pullRequests: pullRequestsEnabled, servers: serversEnabled, ralph: ralphEnabled, vimNavigation: vimNavigationEnabled, loops: loopsEnabled, focusedDiff: focusedDiffEnabled });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setFeaturesSaving(false);
        }
    }, [terminalEnabled, notesEnabled, myWorkEnabled, myLifeEnabled, scratchpadEnabled, scratchpadLayout, workflowsEnabled, pullRequestsEnabled, serversEnabled, ralphEnabled, vimNavigationEnabled, loopsEnabled, focusedDiffEnabled, addToast]);

    const handleCancelFeatures = useCallback(() => {
        setTerminalEnabled(featuresSnapshot.terminal);
        setNotesEnabled(featuresSnapshot.notes);
        setMyWorkEnabled(featuresSnapshot.myWork);
        setMyLifeEnabled(featuresSnapshot.myLife);
        setScratchpadEnabled(featuresSnapshot.scratchpad);
        setScratchpadLayout(featuresSnapshot.scratchpadLayout);
        setWorkflowsEnabled(featuresSnapshot.workflows);
        setPullRequestsEnabled(featuresSnapshot.pullRequests);
        setServersEnabled(featuresSnapshot.servers);
        setRalphEnabled(featuresSnapshot.ralph);
        setVimNavigationEnabled(featuresSnapshot.vimNavigation);
        setLoopsEnabled(featuresSnapshot.loops);
        setFocusedDiffEnabled(featuresSnapshot.focusedDiff);
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

    const inputClass = 'flex-1 px-2 py-0.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] w-full';
    const labelClass = 'text-xs w-28 shrink-0 text-[#616161] dark:text-[#999]';
    const sectionHeadClass = 'text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide mb-2';
    const dividerClass = 'border-t border-[#e0e0e0] dark:border-[#3c3c3c] my-3';
    const baseTabs: AdminSubTab[] = ['settings', 'providers', 'data', 'server', 'prompts', 'database'];
    const tabs: AdminSubTab[] = isContainerMode() ? [...baseTabs, 'agents'] : baseTabs;

    return (
        <div id="view-admin">
            <div id="admin-page-content" className="responsive-container space-y-2 md:space-y-3">
                {/* Header with inline stats bar */}
                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h1 className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Admin</h1>
                    <div className="flex items-center gap-3">
                        {statsLoading ? (
                            <Spinner size="sm" />
                        ) : (
                            <>
                                <span className="text-xs font-mono text-[#616161] dark:text-[#999]" data-testid="stat-processes">
                                    <span className="inline-block w-2 h-2 rounded-full bg-[#0078d4] mr-1 align-middle" />
                                    {stats?.processCount ?? '—'} processes
                                </span>
                                <span className="text-xs font-mono text-[#616161] dark:text-[#999]" data-testid="stat-wikis">
                                    <span className="inline-block w-2 h-2 rounded-full bg-[#0078d4] mr-1 align-middle" />
                                    {stats?.wikiCount ?? '—'} wikis
                                </span>
                                <span className="text-xs font-mono text-[#616161] dark:text-[#999]" data-testid="stat-disk">
                                    <span className="inline-block w-2 h-2 rounded-full bg-[#0078d4] mr-1 align-middle" />
                                    {stats?.totalBytes != null ? formatBytes(stats.totalBytes) : '—'}
                                </span>
                            </>
                        )}
                        <button
                            id="admin-refresh-stats"
                            onClick={loadStats}
                            title="Refresh stats"
                            className="text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-base leading-none"
                        >↻</button>
                    </div>
                </header>

                <FeatureTip tipId="admin-intro" />

                {/* Tab bar — desktop: underline tabs; mobile: select */}
                <div className="hidden md:flex border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {tabs.map(tab => (
                        <button
                            key={tab}
                            className={[
                                'px-4 py-2 text-xs font-medium border-b-2 transition-colors',
                                activeTab === tab
                                    ? 'border-[#0078d4] text-[#0078d4]'
                                    : 'border-transparent text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                            ].join(' ')}
                            onClick={() => handleTabChange(tab)}
                            data-testid={`admin-tab-${tab}`}
                        >
                            {TAB_LABELS[tab]}
                        </button>
                    ))}
                </div>
                <select
                    className="md:hidden w-full px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                    value={activeTab}
                    onChange={e => handleTabChange(e.target.value as AdminSubTab)}
                    aria-label="Select admin section"
                >
                    {tabs.map(tab => (
                        <option key={tab} value={tab}>{TAB_LABELS[tab]}</option>
                    ))}
                </select>

                {/* ── Settings tab ── */}
                {activeTab === 'settings' && (
                    <div className="space-y-3" data-testid="settings-cards">
                        {configLoading ? (
                            <Card className="p-3 md:p-4">
                                <div className="flex items-center gap-2 text-sm text-[#848484]"><Spinner size="sm" /> Loading…</div>
                            </Card>
                        ) : configError ? (
                            <Card className="p-3 md:p-4">
                                <div data-testid="admin-config-error" className="text-sm text-red-500">{configError}</div>
                            </Card>
                        ) : (
                            <>
                                {/* ── 1. AI & Execution ── */}
                                <SettingsCard
                                    title="AI & Execution"
                                    description="Default model, parallelism, timeout, and output format for AI tasks."
                                    dirty={aiExecDirty}
                                    saving={aiExecSaving}
                                    onSave={handleSaveAiExec}
                                    onCancel={handleCancelAiExec}
                                    data-testid="settings-ai-execution"
                                >
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1.5">
                                        <label className={labelClass} title="AI model identifier (leave blank to use server default)">Model</label>
                                        <input
                                            id="admin-config-model"
                                            className={inputClass}
                                            value={configForm.model}
                                            onChange={e => setConfigForm(f => ({ ...f, model: e.target.value }))}
                                        />
                                        <SourceBadge source={sources['model']} />
                                    </div>
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1.5">
                                        <label className={labelClass} title="Number of parallel AI tasks">Parallelism</label>
                                        <input
                                            id="admin-config-parallel"
                                            type="number"
                                            min={1}
                                            className={inputClass}
                                            value={configForm.parallel}
                                            onChange={e => setConfigForm(f => ({ ...f, parallel: e.target.value }))}
                                        />
                                        <SourceBadge source={sources['parallel']} />
                                    </div>
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1.5">
                                        <label className={labelClass} title="AI task execution timeout in seconds. Leave empty for 1-hour default.">Timeout</label>
                                        <input
                                            id="admin-config-timeout"
                                            type="number"
                                            min={1}
                                            placeholder="3600 (1 h default)"
                                            className={inputClass}
                                            value={configForm.timeout}
                                            onChange={e => setConfigForm(f => ({ ...f, timeout: e.target.value }))}
                                        />
                                        <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">s</span>
                                        <SourceBadge source={sources['timeout']} />
                                    </div>
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1.5">
                                        <label className={labelClass} title="Default output format for CLI">Output</label>
                                        <select
                                            id="admin-config-output"
                                            className={inputClass}
                                            value={configForm.output}
                                            onChange={e => setConfigForm(f => ({ ...f, output: e.target.value }))}
                                        >
                                            {VALID_OUTPUT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                        <SourceBadge source={sources['output']} />
                                    </div>
                                </SettingsCard>

                                {/* ── 2. Chat Experience ── */}
                                <SettingsCard
                                    title="Chat Experience"
                                    description="Controls how the AI assistant behaves during conversations."
                                    dirty={chatDirty}
                                    saving={chatSaving}
                                    onSave={handleSaveChat}
                                    onCancel={handleCancelChat}
                                    data-testid="settings-chat"
                                >
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="Generate clickable follow-up suggestions after each response">
                                            Follow-up suggestions
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['chat.followUpSuggestions.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={chatFollowUpEnabled}
                                                    onChange={e => setChatFollowUpEnabled(e.target.checked)}
                                                    data-testid="toggle-chat-followup-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1.5">
                                        <label className={labelClass} title="Number of follow-up suggestions (1–5)">Count</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={5}
                                            className={inputClass}
                                            value={chatFollowUpCount}
                                            onChange={e => setChatFollowUpCount(e.target.value)}
                                            data-testid="input-chat-followup-count"
                                        />
                                        <SourceBadge source={sources['chat.followUpSuggestions.count']} />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="Allow the AI to ask interactive questions during a conversation">
                                            Ask user (interactive questions)
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['chat.askUser.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={chatAskUserEnabled}
                                                    onChange={e => setChatAskUserEnabled(e.target.checked)}
                                                    data-testid="toggle-chat-askuser-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="Show or hide report_intent tool calls in the conversation view">
                                            Intent announcements
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['showReportIntent']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={showReportIntent}
                                                    onChange={e => setShowReportIntent(e.target.checked)}
                                                    data-testid="toggle-show-report-intent"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="How much detail to show for tool calls in the conversation view">
                                            Tool call verbosity
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['toolCompactness']} />
                                            <div
                                                className="flex rounded-md overflow-hidden border border-[#e0e0e0] dark:border-[#3c3c3c]"
                                                role="group"
                                                aria-label="Tool call verbosity"
                                            >
                                                {([
                                                    [0, 'Full'],
                                                    [1, 'Compact'],
                                                    [2, 'Minimal'],
                                                    [3, 'Whisper'],
                                                ] as const).map(([level, label]) => (
                                                    <button
                                                        key={level}
                                                        type="button"
                                                        onClick={() => setToolCompactness(level)}
                                                        data-testid={`tool-compactness-${label.toLowerCase()}`}
                                                        className={[
                                                            'px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]',
                                                            'border-r last:border-r-0 border-[#e0e0e0] dark:border-[#3c3c3c]',
                                                            toolCompactness === level
                                                                ? 'bg-[#0078d4] text-white'
                                                                : 'bg-transparent text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                                        ].join(' ')}
                                                        aria-pressed={toolCompactness === level}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* ── 3. Appearance & Navigation ── */}
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
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
                                        <label className={labelClass}>Theme</label>
                                        <select
                                            className={inputClass}
                                            value={theme}
                                            onChange={e => setTheme(e.target.value as 'light' | 'dark' | 'auto')}
                                            data-testid="pref-theme"
                                        >
                                            <option value="auto">auto</option>
                                            <option value="light">light</option>
                                            <option value="dark">dark</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
                                        <label className={labelClass}>UI Mode</label>
                                        <select
                                            className={inputClass}
                                            value={uiLayoutMode}
                                            onChange={e => setUiLayoutMode(e.target.value as 'classic' | 'dev-workflow')}
                                            data-testid="pref-ui-layout-mode"
                                        >
                                            <option value="dev-workflow">Dev Workflow (Chats + Work Items + Tasks)</option>
                                            <option value="classic">Classic (Activity)</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Repos sidebar collapsed</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Whether the repos sidebar is collapsed on load.</div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={reposSidebarCollapsed}
                                                onChange={e => setReposSidebarCollapsed(e.target.checked)}
                                                data-testid="pref-repos-sidebar-collapsed"
                                            />
                                            <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                        </label>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Inline HTML previews</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">
                                                Render local <span className="font-mono">.html</span> links titled <span className="font-mono">embed</span> as sandboxed chat previews.
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={htmlEmbedEnabled}
                                                onChange={e => setHtmlEmbedEnabled(e.target.checked)}
                                                data-testid="pref-html-embed-enabled"
                                            />
                                            <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                        </label>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Prompt ghost text</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">
                                                Show inline autocomplete in Queue Task and follow-up inputs.
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={promptAutocompleteEnabled}
                                                onChange={e => setPromptAutocompleteEnabled(e.target.checked)}
                                                data-testid="pref-prompt-autocomplete-enabled"
                                            />
                                            <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                        </label>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">AI prompt ghost text</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">
                                                Generate ghost text with AI using workspace-scoped user history. Disabled by default.
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={promptAutocompleteAiEnabled}
                                                disabled={!promptAutocompleteEnabled}
                                                onChange={e => setPromptAutocompleteAiEnabled(e.target.checked)}
                                                data-testid="pref-prompt-autocomplete-ai-enabled"
                                            />
                                            <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-disabled:opacity-50 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                        </label>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="Density of task cards in the activity tab">
                                            Task card density
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['taskCardDensity']} />
                                            <div
                                                className="flex rounded-md overflow-hidden border border-[#e0e0e0] dark:border-[#3c3c3c]"
                                                role="group"
                                                aria-label="Task card density"
                                            >
                                                {([
                                                    ['compact', 'Compact'],
                                                    ['dense', 'Dense'],
                                                ] as const).map(([value, label]) => (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        onClick={() => setTaskCardDensity(value)}
                                                        data-testid={`task-card-density-${label.toLowerCase()}`}
                                                        className={[
                                                            'px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]',
                                                            'border-r last:border-r-0 border-[#e0e0e0] dark:border-[#3c3c3c]',
                                                            taskCardDensity === value
                                                                ? 'bg-[#0078d4] text-white'
                                                                : 'bg-transparent text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                                        ].join(' ')}
                                                        aria-pressed={taskCardDensity === value}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                                               title="Group related plan and autopilot tasks together in the history list">
                                            History grouping
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['historyGrouping']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={historyGrouping}
                                                    onChange={e => setHistoryGrouping(e.target.checked)}
                                                    data-testid="toggle-history-grouping"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* ── 4. Workspace Features ── */}
                                <SettingsCard
                                    title="Workspace Features"
                                    description="Enable or disable optional dashboard features."
                                    dirty={featuresDirty}
                                    saving={featuresSaving}
                                    onSave={handleSaveFeatures}
                                    onCancel={handleCancelFeatures}
                                    data-testid="settings-features"
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Terminal</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Web terminal for shell access to the server machine.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['terminal.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={terminalEnabled}
                                                    onChange={e => setTerminalEnabled(e.target.checked)}
                                                    data-testid="toggle-terminal-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Notes</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Markdown notebooks for creating and editing notes.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['notes.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={notesEnabled}
                                                    onChange={e => setNotesEnabled(e.target.checked)}
                                                    data-testid="toggle-notes-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">My Work</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Personal landing page with action items and weekly summaries.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['myWork.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={myWorkEnabled}
                                                    onChange={e => setMyWorkEnabled(e.target.checked)}
                                                    data-testid="toggle-mywork-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">My Life</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Personal page with goals, journal, and life admin.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['myLife.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={myLifeEnabled}
                                                    onChange={e => setMyLifeEnabled(e.target.checked)}
                                                    data-testid="toggle-mylife-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Scratchpad panel</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Bottom-split note editor inside the chat detail view.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['scratchpad.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={scratchpadEnabled}
                                                    onChange={e => setScratchpadEnabled(e.target.checked)}
                                                    data-testid="toggle-scratchpad-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    {scratchpadEnabled && (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Layout</div>
                                                <div className="text-xs text-[#616161] dark:text-[#999]">Split direction for conversation and scratchpad.</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <SourceBadge source={sources['scratchpad.layout']} />
                                                <select
                                                    className="text-xs border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded px-2 py-1"
                                                    value={scratchpadLayout}
                                                    onChange={e => setScratchpadLayout(e.target.value as 'horizontal' | 'vertical')}
                                                    data-testid="select-scratchpad-layout"
                                                >
                                                    <option value="horizontal">Horizontal (top/bottom)</option>
                                                    <option value="vertical">Vertical (left/right)</option>
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Workflows Tab</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">YAML workflow runner tab in repo view.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['workflows.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={workflowsEnabled}
                                                    onChange={e => setWorkflowsEnabled(e.target.checked)}
                                                    data-testid="toggle-workflows-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Pull Requests Tab</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Pull request list tab in repo view.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['pullRequests.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={pullRequestsEnabled}
                                                    onChange={e => setPullRequestsEnabled(e.target.checked)}
                                                    data-testid="toggle-pull-requests-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Servers</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Multi-server connection manager (devtunnel).</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['servers.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={serversEnabled}
                                                    onChange={e => setServersEnabled(e.target.checked)}
                                                    data-testid="toggle-servers-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Ralph Mode</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Autonomous iterative coding loop — stateless agents with fresh context per iteration.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['ralph.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={ralphEnabled}
                                                    onChange={e => setRalphEnabled(e.target.checked)}
                                                    data-testid="toggle-ralph-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Vim-style navigation</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Enable hjkl pane navigation, j/k to step through chats and messages, gg/G to jump, i to focus the input, Esc to blur. Disabled by default.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['vimNavigation.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={vimNavigationEnabled}
                                                    onChange={e => setVimNavigationEnabled(e.target.checked)}
                                                    data-testid="toggle-vim-navigation-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Loops &amp; Wakeups</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">Recurring follow-up loops and one-shot scheduleWakeup tool. Disabled by default — toggling requires a server restart to (de)wire infrastructure.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['loops.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={loopsEnabled}
                                                    onChange={e => setLoopsEnabled(e.target.checked)}
                                                    data-testid="toggle-loops-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Focused Diff</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">AI-powered hunk classification for PR diffs. Highlights logic changes and dims mechanical edits.</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['features.focusedDiff']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={focusedDiffEnabled}
                                                    onChange={e => setFocusedDiffEnabled(e.target.checked)}
                                                    data-testid="toggle-focused-diff-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* ── 5. Link Handlers ── */}
                                <SettingsCard
                                    badge="Global"
                                    description="Open specific URLs in desktop apps instead of a browser tab. Requires the desktop app to be installed."
                                    data-testid="settings-link-handlers"
                                >
                                    {getLinkHandlersMeta().map(meta => (
                                        <div key={meta.name} className="flex items-center justify-between">
                                            <div>
                                                <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">{meta.label}</div>
                                                <div className="text-xs text-[#616161] dark:text-[#999]">{meta.description}</div>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer ml-4">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={linkHandlersConfig[meta.name] === true}
                                                    onChange={e => setHandlerEnabled(meta.name, e.target.checked)}
                                                    data-testid={`toggle-link-handler-${meta.name}`}
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    ))}
                                </SettingsCard>

                                <SettingsCard
                                    title="Advanced & Recovery"
                                    badge="Advanced"
                                    description="Read-only diagnostics and recovery actions."
                                    data-testid="settings-advanced"
                                >
                                    <div className="text-xs space-y-1 text-[#616161] dark:text-[#999]">
                                        <div>Approve Permissions: {String(resolved.approvePermissions ?? '—')} <SourceBadge source={sources['approvePermissions']} /></div>
                                        <div>MCP Config: {String(resolved.mcpConfig ?? '—')} <SourceBadge source={sources['mcpConfig']} /></div>
                                        <div>Persist: {String(resolved.persist ?? '—')} <SourceBadge source={sources['persist']} /></div>
                                    </div>
                                    {SHOW_WELCOME_TUTORIAL && (
                                        <div className="mt-3 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] space-y-1">
                                            <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Welcome Tour</div>
                                            <div className="text-xs text-[#616161] dark:text-[#999]">
                                                Re-show the welcome modal and reset onboarding progress.
                                            </div>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                loading={relaunchingWelcome}
                                                onClick={handleRelaunchWelcome}
                                                data-testid="relaunch-welcome-btn"
                                            >
                                                Relaunch Welcome Tour
                                            </Button>
                                        </div>
                                    )}
                                </SettingsCard>
                            </>
                        )}
                    </div>
                )}

                {/* ── Providers tab ── */}
                {activeTab === 'providers' && (
                    <Card className="p-2 md:p-3" data-testid="provider-tokens-section">
                        <ProviderTokensSection
                            onError={msg => addToast(msg, 'error')}
                            onSuccess={msg => addToast(msg, 'success')}
                        />
                    </Card>
                )}

                {/* ── Data tab ── */}
                {activeTab === 'data' && (
                    <Card className="p-2 md:p-3">
                        {/* Storage Backend */}
                        <Suspense fallback={<Spinner size="sm" />}>
                            <StorageSection />
                        </Suspense>
                        <hr className={dividerClass} />

                        {/* Export */}
                        <div>
                            <div className={sectionHeadClass}>Export</div>
                            <div className="flex items-center gap-3">
                                <Button id="admin-export-btn" variant="secondary" size="sm" onClick={handleExport}>Export JSON ↓</Button>
                                {exportStatus && <span id="admin-export-status" className="text-xs text-[#848484]">{exportStatus}</span>}
                            </div>
                        </div>

                        <hr className={dividerClass} />

                        {/* Import */}
                        <div>
                            <div className={sectionHeadClass}>Import</div>
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        id="admin-import-file"
                                        type="file"
                                        accept=".json,application/json"
                                        className="text-xs"
                                        onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                                    />
                                    <div className="flex items-center gap-3 text-xs">
                                        <label className="flex items-center gap-1">
                                            <input type="radio" name="import-mode" value="replace" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace
                                        </label>
                                        <label className="flex items-center gap-1">
                                            <input type="radio" name="import-mode" value="merge" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> Merge
                                        </label>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button id="admin-import-preview-btn" variant="secondary" size="sm" onClick={handlePreviewImport}>Preview</Button>
                                    <Button id="admin-import-btn" size="sm" onClick={handleImport}>Import</Button>
                                    {importStatus && <span id="admin-import-status" className="text-xs text-[#848484]">{importStatus}</span>}
                                </div>
                            </div>
                            {importPreview && (
                                <pre id="admin-import-preview" className="mt-2 text-xs bg-black/5 dark:bg-white/5 p-2 rounded whitespace-pre-wrap">{importPreview}</pre>
                            )}
                        </div>

                        <hr className={dividerClass} />

                        {/* Danger Zone */}
                        <div>
                            <div className={`${sectionHeadClass} text-red-600 dark:text-red-400`}>Danger Zone</div>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <label className="flex items-center gap-1 text-xs">
                                    <input id="admin-include-wikis" type="checkbox" checked={includeWikis} onChange={e => setIncludeWikis(e.target.checked)} className="accent-red-500" />
                                    Include wikis
                                </label>
                                <Button id="admin-preview-wipe" variant="secondary" size="sm" onClick={handlePreviewWipe}>Preview</Button>
                                {wipeToken === null ? (
                                    <Button id="admin-wipe-btn" variant="danger" size="sm" onClick={handleWipeStep1}>Wipe Data</Button>
                                ) : (
                                    <>
                                        <Button id="admin-wipe-confirm" variant="danger" size="sm" onClick={handleWipeConfirm}>Confirm Wipe</Button>
                                        <Button id="admin-wipe-cancel" variant="secondary" size="sm" onClick={handleWipeCancel}>Cancel</Button>
                                    </>
                                )}
                                {wipeStatus && <span id="admin-wipe-status" className="text-xs text-[#848484]">{wipeStatus}</span>}
                            </div>
                            {wipePreview && (
                                <pre id="admin-wipe-preview" className="text-xs bg-black/5 dark:bg-white/5 p-2 rounded whitespace-pre-wrap">{wipePreview}</pre>
                            )}
                        </div>
                    </Card>
                )}

                {/* ── Server tab ── */}
                {activeTab === 'server' && (
                    <Card className="p-2 md:p-3">
                        {/* Server info */}
                        <div className="space-y-1 text-xs text-[#616161] dark:text-[#999]">
                            {config?.configFilePath && (
                                <div>Config file: <code className="bg-black/5 dark:bg-white/5 px-1 rounded">{config.configFilePath}</code></div>
                            )}
                            <div>
                                Serve{' '}
                                <span className="font-mono">{resolved.serve?.host ?? '127.0.0.1'}:{resolved.serve?.port ?? '4000'}</span>
                                {resolved.serve?.dataDir && <span className="ml-2 font-mono">{resolved.serve.dataDir}</span>}
                            </div>
                            {versionInfo && (
                                <div>
                                    Version: <code className="bg-black/5 dark:bg-white/5 px-1 rounded">{versionInfo.version}</code>
                                    {' · '}Commit: <code className="bg-black/5 dark:bg-white/5 px-1 rounded" title={versionInfo.commit}>{versionInfo.commit.slice(0, 7)}</code>
                                </div>
                            )}
                        </div>

                        <hr className={dividerClass} />

                        {/* Server name */}
                        <div>
                            <div className={sectionHeadClass}>Display Name</div>
                            <p className="text-xs text-[#616161] dark:text-[#999] mb-2">
                                Short name shown in the dashboard title bar (e.g. <code className="bg-black/5 dark:bg-white/5 px-1 rounded">MBP</code>).
                                Leave blank to use the auto-shortened hostname.
                                Takes effect on next page reload.
                            </p>
                            <div className="flex items-center gap-2">
                                <label className={labelClass} htmlFor="admin-server-name">Name</label>
                                <input
                                    id="admin-server-name"
                                    type="text"
                                    maxLength={64}
                                    placeholder={resolved.serve?.host ? `auto (${resolved.serve.host})` : 'auto'}
                                    value={serverName}
                                    onChange={e => setServerName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveServerName(); }}
                                    className={inputClass}
                                />
                                <SourceBadge source={sources['serve.serverName']} />
                                <Button id="admin-server-name-save" variant="secondary" size="sm" onClick={handleSaveServerName}>Save</Button>
                            </div>
                        </div>

                        <hr className={dividerClass} />

                        {/* Restart */}
                        <div>
                            <div className={sectionHeadClass}>Restart</div>
                            <p className="text-xs text-[#616161] dark:text-[#999] mb-2">Rebuild and restart the CoC server process.</p>
                            <div className="flex items-center gap-3">
                                <Button id="admin-restart-btn" variant="secondary" size="sm" onClick={handleRestart} disabled={restarting}>
                                    {restarting ? <><Spinner size="sm" /> Restarting…</> : 'Rebuild & Restart'}
                                </Button>
                                {restartStatus && <span id="admin-restart-status" className="text-xs text-[#848484]">{restartStatus}</span>}
                            </div>
                        </div>
                    </Card>
                )}

                {/* ── Prompts tab ── */}
                {activeTab === 'prompts' && (
                    <Card className="p-2 md:p-3">
                        <PromptsPanel onError={msg => addToast(msg, 'error')} />
                    </Card>
                )}

                {activeTab === 'database' && (
                    <Card className="p-2 md:p-3">
                        <DbBrowserSection />
                    </Card>
                )}

                {activeTab === 'agents' && isContainerMode() && (
                    <Suspense fallback={<div className="flex items-center gap-2 text-sm text-[#848484]"><Spinner size="sm" /> Loading…</div>}>
                        <AgentManagementPanel />
                    </Suspense>
                )}

                <ToastContainer toasts={toasts} removeToast={removeToast} />
            </div>
        </div>
    );
}

function SourceBadge({ source }: { source?: string }) {
    const s = source || 'default';
    const colors: Record<string, string> = {
        default: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
        file: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
        cli: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
        env: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300',
    };
    return (
        <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${colors[s] || colors.default}`}>
            {s}
        </span>
    );
}
