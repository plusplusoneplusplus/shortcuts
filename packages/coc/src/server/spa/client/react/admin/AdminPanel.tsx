/**
 * AdminPanel — full admin page replacing vanilla admin.ts.
 * Storage stats, config view, export, import, and data wipe.
 */

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Card, Button, Spinner, useToast, ToastContainer } from '../shared';
import { getApiBase } from '../utils/config';
import { invalidateDisplaySettings } from '../hooks/useDisplaySettings';
import { PreferencesSection } from './PreferencesSection';
import { ProviderTokensSection } from './ProviderTokensSection';
import { PromptsPanel } from './PromptsPanel';
import { DbBrowserSection } from './DbBrowserSection';
import { useApp } from '../context/AppContext';
import { FeatureTip } from '../welcome/FeatureTip';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import type { AdminSubTab } from '../types/dashboard';

const StorageSection = lazy(() => import('./StorageSection'));

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
const TAB_LABELS: Record<AdminSubTab, string> = { settings: 'Settings', providers: 'Providers', data: 'Data', server: 'Server', prompts: 'Prompts', database: 'Database' };

export function AdminPanel() {
    const { toasts, addToast, removeToast } = useToast();
    const { state, dispatch } = useApp();
    const activeTab = state.activeAdminSubTab;
    const handleTabChange = (tab: AdminSubTab) => {
        dispatch({ type: 'SET_ADMIN_SUB_TAB', tab });
        window.location.hash = `admin/${tab}`;
    };
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        if (!state.onboardingProgress?.settingsVisited) {
            dispatch({ type: 'UPDATE_ONBOARDING', payload: { settingsVisited: true } });
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
    const [configSaving, setConfigSaving] = useState(false);

    // Display settings
    const [showReportIntent, setShowReportIntent] = useState(false);
    const [toolCompactness, setToolCompactness] = useState<0 | 1 | 2 | 3>(3);
    const [taskCardDensity, setTaskCardDensity] = useState<'compact' | 'dense'>('dense');
    const [displaySaving, setDisplaySaving] = useState(false);

    // Chat settings
    const [chatFollowUpEnabled, setChatFollowUpEnabled] = useState(true);
    const [chatFollowUpCount, setChatFollowUpCount] = useState('3');

    // Server name (cosmetic display name in title bar)
    const [serverName, setServerName] = useState('');

    // Terminal settings
    const [terminalEnabled, setTerminalEnabled] = useState(false);

    // Notes settings
    const [notesEnabled, setNotesEnabled] = useState(false);

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

    // Relaunch welcome
    const [relaunchingWelcome, setRelaunchingWelcome] = useState(false);

    const loadStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const res = await fetch(getApiBase() + '/admin/data/stats?includeWikis=true');
            if (!res.ok) throw new Error('Failed to load stats');
            const data = await res.json();
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
            const res = await fetch(getApiBase() + '/admin/config');
            if (!res.ok) throw new Error('Failed to load configuration');
            const data = await res.json();
            setConfig(data);
            const resolved = data.resolved ?? {};
            setConfigForm({
                model: resolved.model ?? '',
                parallel: String(resolved.parallel ?? 1),
                timeout: resolved.timeout != null ? String(resolved.timeout) : '',
                output: resolved.output ?? 'table',
            });
            setShowReportIntent(resolved.showReportIntent ?? false);
            setToolCompactness((resolved.toolCompactness ?? 1) as 0 | 1 | 2 | 3);
            setTaskCardDensity((resolved.taskCardDensity === 'dense' ? 'dense' : 'compact') as 'compact' | 'dense');
            setChatFollowUpEnabled(resolved.chat?.followUpSuggestions?.enabled ?? true);
            setChatFollowUpCount(String(resolved.chat?.followUpSuggestions?.count ?? 3));
            setServerName(resolved.serve?.serverName ?? '');
            setTerminalEnabled(resolved.terminal?.enabled ?? false);
            setNotesEnabled(resolved.notes?.enabled ?? false);
        } catch (err: any) {
            setConfigError(err.message || 'Failed to load configuration');
        } finally {
            setConfigLoading(false);
        }
    }, []);

    useEffect(() => {
        loadStats();
        loadConfig();
    }, [loadStats, loadConfig]);

    const handleSaveSettings = useCallback(async () => {
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
        const count = Number(chatFollowUpCount);
        if (isNaN(count) || !Number.isInteger(count) || count < 1 || count > 5) {
            errors.push('Follow-up count must be an integer between 1 and 5');
        }
        if (errors.length) {
            addToast(errors.join('; '), 'error');
            return;
        }
        setConfigSaving(true);
        try {
            const payload: Record<string, unknown> = {
                parallel,
                output: configForm.output,
                'chat.followUpSuggestions.enabled': chatFollowUpEnabled,
                'chat.followUpSuggestions.count': count,
            };
            if (configForm.model?.trim()) payload.model = configForm.model.trim();
            payload.timeout = timeoutValue;
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Settings saved', 'success');
            await loadConfig();
        } catch (err: any) {
            addToast(err.message || 'Save failed', 'error');
        } finally {
            setConfigSaving(false);
        }
    }, [configForm, chatFollowUpEnabled, chatFollowUpCount, addToast, loadConfig]);

    const handleToggleShowReportIntent = useCallback(async (newValue: boolean) => {
        const prevValue = showReportIntent;
        setShowReportIntent(newValue);
        setDisplaySaving(true);
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showReportIntent: newValue }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
        } catch (err: any) {
            setShowReportIntent(prevValue);
            addToast(err.message || 'Could not persist setting. Config may be read-only.', 'error');
        } finally {
            setDisplaySaving(false);
        }
    }, [showReportIntent, addToast]);

    const handleToggleTerminalEnabled = useCallback(async (newValue: boolean) => {
        const prevValue = terminalEnabled;
        setTerminalEnabled(newValue);
        setDisplaySaving(true);
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'terminal.enabled': newValue }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
        } catch (err: any) {
            setTerminalEnabled(prevValue);
            addToast(err.message || 'Could not persist setting. Config may be read-only.', 'error');
        } finally {
            setDisplaySaving(false);
        }
    }, [terminalEnabled, addToast]);

    const handleToggleNotesEnabled = useCallback(async (newValue: boolean) => {
        const prevValue = notesEnabled;
        setNotesEnabled(newValue);
        setDisplaySaving(true);
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'notes.enabled': newValue }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
        } catch (err: any) {
            setNotesEnabled(prevValue);
            addToast(err.message || 'Could not persist setting. Config may be read-only.', 'error');
        } finally {
            setDisplaySaving(false);
        }
    }, [notesEnabled, addToast]);

    const handleChangeToolCompactness= useCallback(async (newValue: 0 | 1 | 2 | 3) => {
        const prevValue = toolCompactness;
        setToolCompactness(newValue);
        setDisplaySaving(true);
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolCompactness: newValue }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
        } catch (err: any) {
            setToolCompactness(prevValue);
            addToast(err.message || 'Could not persist setting. Config may be read-only.', 'error');
        } finally {
            setDisplaySaving(false);
        }
    }, [toolCompactness, addToast]);

    const handleChangeTaskCardDensity = useCallback(async (newValue: 'compact' | 'dense') => {
        const prevValue = taskCardDensity;
        setTaskCardDensity(newValue);
        setDisplaySaving(true);
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskCardDensity: newValue }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
        } catch (err: any) {
            setTaskCardDensity(prevValue);
            addToast(err.message || 'Could not persist setting. Config may be read-only.', 'error');
        } finally {
            setDisplaySaving(false);
        }
    }, [taskCardDensity, addToast]);

    const handleSaveServerName = useCallback(async () => {
        const trimmed = serverName.trim();
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'serve.serverName': trimmed || null }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            setServerName(trimmed);
            addToast('Server name saved — takes effect on next page reload', 'success');
            await loadConfig();
        } catch (err: any) {
            addToast(err.message || 'Could not save server name', 'error');
        }
    }, [serverName, addToast, loadConfig]);

    const handleExport= useCallback(async () => {
        setExportStatus('Exporting…');
        try {
            const res = await fetch(getApiBase() + '/admin/export');
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || res.statusText);
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
        } catch (err: any) {
            setExportStatus('Export failed: ' + (err.message || 'Network error'));
        }
    }, []);

    const handlePreviewImport = useCallback(async () => {
        if (!importFile) { setImportStatus('Please select a JSON file first.'); return; }
        setImportStatus('Loading preview…');
        try {
            const text = await importFile.text();
            const payload = JSON.parse(text);
            const res = await fetch(getApiBase() + '/admin/import/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.valid) {
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
        } catch {
            setImportPreview(null);
            setImportStatus('Invalid JSON file.');
        }
    }, [importFile]);

    const handleImport = useCallback(async () => {
        if (!importFile) { setImportStatus('Please select a JSON file first.'); return; }
        setImportStatus('Requesting confirmation token…');
        try {
            const text = await importFile.text();
            const payload = JSON.parse(text);
            const tokenRes = await fetch(getApiBase() + '/admin/import-token').then(r => r.json());
            if (!tokenRes?.token) { setImportStatus('Failed to get import token.'); return; }
            setImportStatus('Importing…');
            const res = await fetch(
                getApiBase() + '/admin/import?confirm=' + encodeURIComponent(tokenRes.token) + '&mode=' + importMode,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
            );
            if (res.ok) {
                setImportStatus('Import complete.');
                addToast('Import complete', 'success');
                loadStats();
            } else {
                const body = await res.json().catch(() => ({}));
                setImportStatus('Import failed: ' + (body.error || res.statusText));
            }
        } catch (err: any) {
            setImportStatus('Import failed: ' + (err.message || 'Network error'));
        }
    }, [importFile, importMode, addToast, loadStats]);

    const handlePreviewWipe = useCallback(async () => {
        try {
            const res = await fetch(getApiBase() + '/admin/data/stats?includeWikis=' + includeWikis);
            if (!res.ok) { setWipePreview('Failed to load preview.'); return; }
            const data = await res.json();
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
            const res = await fetch(getApiBase() + '/admin/data/wipe-token');
            if (!res.ok) throw new Error('Failed to get wipe token');
            const data = await res.json();
            if (!data.token) throw new Error('No token received');
            setWipeToken(data.token);
            setWipeStatus('');
        } catch (err: any) {
            setWipeStatus(err.message);
        }
    }, []);

    const handleWipeConfirm = useCallback(async () => {
        if (!wipeToken) return;
        setWipeStatus('Wiping data…');
        try {
            const res = await fetch(
                getApiBase() + '/admin/data?confirm=' + encodeURIComponent(wipeToken) + '&includeWikis=' + includeWikis,
                { method: 'DELETE' }
            );
            if (res.ok) {
                setWipeStatus('Data wiped successfully.');
                addToast('Data wiped', 'success');
                setWipeToken(null);
                loadStats();
            } else {
                const body = await res.json().catch(() => ({}));
                setWipeStatus('Wipe failed: ' + (body.error || res.statusText));
            }
        } catch (err: any) {
            setWipeStatus('Wipe failed: ' + (err.message || 'Network error'));
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
            const res = await fetch(getApiBase() + '/admin/restart', { method: 'POST' });
            if (res.ok) {
                setRestartStatus('Server is restarting. Waiting for it to come back…');
                addToast('Restart initiated — rebuilding…', 'success');
                // Poll until the server comes back, then reload the page
                const poll = () => {
                    setTimeout(async () => {
                        try {
                            const ping = await fetch(getApiBase() + '/admin/data/stats', { signal: AbortSignal.timeout(2000) });
                            if (ping.ok) {
                                setRestartStatus('Server is back!');
                                window.location.reload();
                                return;
                            }
                        } catch { /* server still down */ }
                        poll();
                    }, 3000);
                };
                poll();
            } else {
                const body = await res.json().catch(() => ({}));
                setRestartStatus('Restart failed: ' + (body.error || res.statusText));
                setRestarting(false);
            }
        } catch (err: any) {
            setRestartStatus('Restart failed: ' + (err.message || 'Network error'));
            setRestarting(false);
        }
    }, [addToast]);

    const handleRelaunchWelcome = useCallback(async () => {
        setRelaunchingWelcome(true);
        try {
            const res = await fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hasSeenWelcome: false,
                    onboardingProgress: {},
                    dismissedTips: [],
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as any).error || 'Reset failed');
            }
            dispatch({ type: 'SET_WELCOME_PREFERENCES', payload: { hasSeenWelcome: false, onboardingProgress: {}, dismissedTips: [] } });
            addToast('Welcome tour will appear on next page load', 'success');
        } catch (err: any) {
            addToast(err.message || 'Failed to reset welcome tour', 'error');
        } finally {
            setRelaunchingWelcome(false);
        }
    }, [dispatch, addToast]);

    const sources: Record<string, string> = config?.sources ?? {};
    const resolved = config?.resolved ?? {};

    const inputClass = 'flex-1 px-2 py-0.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] w-full';
    const labelClass = 'text-xs w-28 shrink-0 text-[#616161] dark:text-[#999]';
    const sectionHeadClass = 'text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide mb-2';
    const dividerClass = 'border-t border-[#e0e0e0] dark:border-[#3c3c3c] my-3';
    const tabs: AdminSubTab[] = ['settings', 'providers', 'data', 'server', 'prompts', 'database'];

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
                    <Card className="p-2 md:p-3">
                        {configLoading ? (
                            <div className="flex items-center gap-2 text-sm text-[#848484]"><Spinner size="sm" /> Loading…</div>
                        ) : configError ? (
                            <div data-testid="admin-config-error" className="text-sm text-red-500">{configError}</div>
                        ) : (
                            <>
                                {/* Config section */}
                                <div className="space-y-1.5">
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
                                </div>

                                {/* Advanced accordion — read-only fields */}
                                <div className="mt-2">
                                    <button
                                        type="button"
                                        className="flex items-center gap-1 text-xs text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                        onClick={() => setShowAdvanced(v => !v)}
                                        aria-expanded={showAdvanced}
                                    >
                                        <span className={`inline-block transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
                                        Advanced
                                    </button>
                                    {showAdvanced && (
                                        <div className="mt-2 text-xs space-y-1 text-[#616161] dark:text-[#999]">
                                            <div>Approve Permissions: {String(resolved.approvePermissions ?? '—')} <SourceBadge source={sources['approvePermissions']} /></div>
                                            <div>MCP Config: {String(resolved.mcpConfig ?? '—')} <SourceBadge source={sources['mcpConfig']} /></div>
                                            <div>Persist: {String(resolved.persist ?? '—')} <SourceBadge source={sources['persist']} /></div>
                                        </div>
                                    )}
                                </div>

                                <hr className={dividerClass} />

                                {/* Display section */}
                                <div className="space-y-2">
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
                                                    disabled={displaySaving}
                                                    onChange={e => void handleToggleShowReportIntent(e.target.checked)}
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
                                                        disabled={displaySaving}
                                                        onClick={() => void handleChangeToolCompactness(level)}
                                                        data-testid={`tool-compactness-${label.toLowerCase()}`}
                                                        className={[
                                                            'px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4] disabled:opacity-50 disabled:cursor-not-allowed',
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
                                                        disabled={displaySaving}
                                                        onClick={() => void handleChangeTaskCardDensity(value)}
                                                        data-testid={`task-card-density-${label.toLowerCase()}`}
                                                        className={[
                                                            'px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4] disabled:opacity-50 disabled:cursor-not-allowed',
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
                                </div>

                                <hr className={dividerClass} />

                                {/* Chat section */}
                                <div className="space-y-1.5">
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
                                                    disabled={configSaving}
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
                                            disabled={configSaving}
                                            onChange={e => setChatFollowUpCount(e.target.value)}
                                            data-testid="input-chat-followup-count"
                                        />
                                        <SourceBadge source={sources['chat.followUpSuggestions.count']} />
                                    </div>
                                </div>

                                <hr className={dividerClass} />

                                {/* Terminal section */}
                                <div className="space-y-1.5">
                                    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Terminal</div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="Enable the web terminal feature in the dashboard">
                                            Enable web terminal
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['terminal.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={terminalEnabled}
                                                    disabled={displaySaving}
                                                    onChange={e => void handleToggleTerminalEnabled(e.target.checked)}
                                                    data-testid="toggle-terminal-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="text-xs text-[#616161] dark:text-[#999]">
                                        When enabled, a Terminal tab appears in the dashboard providing shell access to the server machine.
                                    </div>
                                </div>

                                <hr className={dividerClass} />

                                {/* Notes section */}
                                <div className="space-y-1.5">
                                    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Notes</div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" title="Enable the notes feature in the dashboard">
                                            Enable notes
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <SourceBadge source={sources['notes.enabled']} />
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={notesEnabled}
                                                    disabled={displaySaving}
                                                    onChange={e => void handleToggleNotesEnabled(e.target.checked)}
                                                    data-testid="toggle-notes-enabled"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="text-xs text-[#616161] dark:text-[#999]">
                                        When enabled, a Notes tab appears in the dashboard for creating and editing markdown notebooks.
                                    </div>
                                </div>

                                <hr className={dividerClass} />

                                {/* Preferences section (auto-saves on change) */}
                                <PreferencesSection
                                    onError={msg => addToast(msg, 'error')}
                                    onSuccess={msg => addToast(msg, 'success')}
                                />

                                {SHOW_WELCOME_TUTORIAL && (
                                    <>
                                        <hr className={dividerClass} />
                                        <div className="space-y-1">
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
                                    </>
                                )}

                                <div className="flex justify-end mt-3">
                                    <Button id="admin-config-save" size="sm" onClick={handleSaveSettings} loading={configSaving}>Save</Button>
                                </div>
                            </>
                        )}
                    </Card>
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
                                <span className="font-mono">{resolved.serve?.host ?? '0.0.0.0'}:{resolved.serve?.port ?? '4000'}</span>
                                {resolved.serve?.dataDir && <span className="ml-2 font-mono">{resolved.serve.dataDir}</span>}
                            </div>
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
