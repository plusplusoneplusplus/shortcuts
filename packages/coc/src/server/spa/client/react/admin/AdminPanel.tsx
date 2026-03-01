/**
 * AdminPanel — full admin page replacing vanilla admin.ts.
 * Storage stats, config view, export, import, and data wipe.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Spinner, useToast, ToastContainer } from '../shared';
import { getApiBase } from '../utils/config';
import { escapeHtml } from '../utils/format';
import { invalidateDisplaySettings } from '../hooks/useDisplaySettings';

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

export function AdminPanel() {
    const { toasts, addToast, removeToast } = useToast();

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
    const [displaySaving, setDisplaySaving] = useState(false);

    // Chat settings
    const [chatFollowUpEnabled, setChatFollowUpEnabled] = useState(true);
    const [chatFollowUpCount, setChatFollowUpCount] = useState('3');
    const [chatSaving, setChatSaving] = useState(false);

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
            setChatFollowUpEnabled(resolved.chat?.followUpSuggestions?.enabled ?? true);
            setChatFollowUpCount(String(resolved.chat?.followUpSuggestions?.count ?? 3));
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

    const handleSaveConfig = useCallback(async () => {
        const errors: string[] = [];
        if (!configForm.model?.trim()) errors.push('Model must be non-empty');
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
        if (errors.length) {
            addToast(errors.join('; '), 'error');
            return;
        }
        setConfigSaving(true);
        try {
            const payload: Record<string, unknown> = { model: configForm.model, parallel, output: configForm.output };
            // Empty timeout = clear from config (send null); present = send value
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
            addToast('Configuration saved', 'success');
            await loadConfig();
        } catch (err: any) {
            addToast(err.message || 'Save failed', 'error');
        } finally {
            setConfigSaving(false);
        }
    }, [configForm, addToast, loadConfig]);

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

    const handleSaveChatSettings = useCallback(async () => {
        const count = Number(chatFollowUpCount);
        if (isNaN(count) || !Number.isInteger(count) || count < 1 || count > 5) {
            addToast('Follow-up count must be an integer between 1 and 5', 'error');
            return;
        }
        setChatSaving(true);
        try {
            const res = await fetch(getApiBase() + '/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    'chat.followUpSuggestions.enabled': chatFollowUpEnabled,
                    'chat.followUpSuggestions.count': count,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            addToast('Chat settings saved', 'success');
            await loadConfig();
        } catch (err: any) {
            addToast(err.message || 'Save failed', 'error');
        } finally {
            setChatSaving(false);
        }
    }, [chatFollowUpEnabled, chatFollowUpCount, addToast, loadConfig]);

    const handleExport = useCallback(async () => {
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

    const sources: Record<string, string> = config?.sources ?? {};
    const resolved = config?.resolved ?? {};

    return (
        <div id="view-admin">
            <div id="admin-page-content" className="p-6 space-y-6">
            <header>
                <h1 className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Admin</h1>
                <p className="text-sm text-[#616161] dark:text-[#999]">Server management and data administration</p>
            </header>

            {/* Storage Stats */}
            <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 text-[#1e1e1e] dark:text-[#cccccc]">Storage Stats</h3>
                {statsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-[#848484]"><Spinner size="sm" /> Loading…</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                        <div id="admin-stat-processes" className="text-center p-3 rounded bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <div className="text-2xl font-bold text-[#0078d4]" data-testid="stat-processes">{stats?.processCount ?? '—'}</div>
                            <div className="text-xs text-[#616161] dark:text-[#999]">Processes</div>
                        </div>
                        <div id="admin-stat-wikis" className="text-center p-3 rounded bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <div className="text-2xl font-bold text-[#0078d4]" data-testid="stat-wikis">{stats?.wikiCount ?? '—'}</div>
                            <div className="text-xs text-[#616161] dark:text-[#999]">Wikis</div>
                        </div>
                        <div id="admin-stat-disk" className="text-center p-3 rounded bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <div className="text-2xl font-bold text-[#0078d4]" data-testid="stat-disk">
                                {stats?.totalBytes != null ? formatBytes(stats.totalBytes) : '—'}
                            </div>
                            <div className="text-xs text-[#616161] dark:text-[#999]">Disk Usage</div>
                        </div>
                    </div>
                )}
                <Button id="admin-refresh-stats" variant="secondary" size="sm" onClick={loadStats}>Refresh</Button>
            </Card>

            {/* Configuration */}
            <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 text-[#1e1e1e] dark:text-[#cccccc]">Configuration</h3>
                {configLoading ? (
                    <div className="flex items-center gap-2 text-sm text-[#848484]"><Spinner size="sm" /> Loading…</div>
                ) : configError ? (
                    <div className="text-sm text-red-500">{configError}</div>
                ) : (
                    <>
                        {config?.configFilePath && (
                            <div className="text-xs text-[#848484] mb-3">
                                Config file: <code className="bg-black/5 dark:bg-white/5 px-1 rounded">{config.configFilePath}</code>
                            </div>
                        )}
                        <div className="space-y-2 mb-3">
                            <div className="flex items-center gap-2">
                                <label className="text-xs w-24 text-[#616161] dark:text-[#999]">Model</label>
                                <input
                                    className="flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                    value={configForm.model}
                                    onChange={e => setConfigForm(f => ({ ...f, model: e.target.value }))}
                                />
                                <SourceBadge source={sources['model']} />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs w-24 text-[#616161] dark:text-[#999]">Parallelism</label>
                                <input
                                    type="number"
                                    min={1}
                                    className="flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                    value={configForm.parallel}
                                    onChange={e => setConfigForm(f => ({ ...f, parallel: e.target.value }))}
                                />
                                <SourceBadge source={sources['parallel']} />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs w-24 text-[#616161] dark:text-[#999]">Timeout</label>
                                <input
                                    type="number"
                                    min={1}
                                    placeholder="3600 (1 h default)"
                                    className="flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                    value={configForm.timeout}
                                    onChange={e => setConfigForm(f => ({ ...f, timeout: e.target.value }))}
                                />
                                <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">s</span>
                                <SourceBadge source={sources['timeout']} />
                            </div>
                            <div className="text-[10px] text-[#848484] ml-[6.5rem]">AI task execution timeout. Leave empty to use the system default (1 hour).</div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs w-24 text-[#616161] dark:text-[#999]">Output</label>
                                <select
                                    className="flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                    value={configForm.output}
                                    onChange={e => setConfigForm(f => ({ ...f, output: e.target.value }))}
                                >
                                    {VALID_OUTPUT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                                <SourceBadge source={sources['output']} />
                            </div>
                        </div>

                        {/* Read-only fields */}
                        <div className="text-xs space-y-1 mb-3 text-[#616161] dark:text-[#999]">
                            <div>Approve Permissions: {String(resolved.approvePermissions ?? '—')} <SourceBadge source={sources['approvePermissions']} /></div>
                            <div>MCP Config: {String(resolved.mcpConfig ?? '—')} <SourceBadge source={sources['mcpConfig']} /></div>
                            <div>Persist: {String(resolved.persist ?? '—')} <SourceBadge source={sources['persist']} /></div>
                            <div>Serve Port: {String(resolved.serve?.port ?? '—')} <SourceBadge source={sources['serve.port']} /></div>
                            <div>Serve Host: {String(resolved.serve?.host ?? '—')} <SourceBadge source={sources['serve.host']} /></div>
                            <div>Serve Data Dir: {String(resolved.serve?.dataDir ?? '—')} <SourceBadge source={sources['serve.dataDir']} /></div>
                        </div>

                        <Button size="sm" onClick={handleSaveConfig} loading={configSaving}>Save</Button>
                    </>
                )}
            </Card>

            {/* Display Settings */}
            <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 text-[#1e1e1e] dark:text-[#cccccc]">Display</h3>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Show intent announcements</div>
                        <div className="text-xs text-[#616161] dark:text-[#999]">
                            Show or hide <code className="bg-black/5 dark:bg-white/5 px-1 rounded">report_intent</code> tool calls in the conversation view.
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer ml-4">
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
                <div className="mt-1">
                    <SourceBadge source={sources['showReportIntent']} />
                </div>
            </Card>

            {/* Chat */}
            <Card className="p-4">
                <h3 className="text-sm font-semibold mb-1 text-[#1e1e1e] dark:text-[#cccccc]">Chat</h3>
                <p className="text-xs text-[#616161] dark:text-[#999] mb-3">Follow-up suggestion settings</p>
                <div className="space-y-2 mb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Enable follow-up suggestions</div>
                            <div className="text-xs text-[#616161] dark:text-[#999]">Generate clickable follow-up suggestions after each response.</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={chatFollowUpEnabled}
                                disabled={chatSaving}
                                onChange={e => setChatFollowUpEnabled(e.target.checked)}
                                data-testid="toggle-chat-followup-enabled"
                            />
                            <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                        </label>
                    </div>
                    <div className="mt-1">
                        <SourceBadge source={sources['chat.followUpSuggestions.enabled']} />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs w-24 text-[#616161] dark:text-[#999]">Count</label>
                        <input
                            type="number"
                            min={1}
                            max={5}
                            className="flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                            value={chatFollowUpCount}
                            disabled={chatSaving}
                            onChange={e => setChatFollowUpCount(e.target.value)}
                            data-testid="input-chat-followup-count"
                        />
                        <SourceBadge source={sources['chat.followUpSuggestions.count']} />
                    </div>
                    <div className="text-[10px] text-[#848484] ml-[6.5rem]">Number of follow-up suggestions (1–5).</div>
                </div>
                <Button size="sm" onClick={handleSaveChatSettings} loading={chatSaving}>Save</Button>
            </Card>

            {/* Export Data */}
            <Card className="p-4">
                <h3 className="text-sm font-semibold mb-2 text-[#1e1e1e] dark:text-[#cccccc]">Export Data</h3>
                <p className="text-xs text-[#616161] dark:text-[#999] mb-3">Download all server data as a JSON file.</p>
                <Button id="admin-export-btn" variant="secondary" size="sm" onClick={handleExport}>Export</Button>
                {exportStatus && <div id="admin-export-status" className="text-xs text-[#848484] mt-2">{exportStatus}</div>}
            </Card>

            {/* Import Data */}
            <Card className="p-4">
                <h3 className="text-sm font-semibold mb-2 text-[#1e1e1e] dark:text-[#cccccc]">Import Data</h3>
                <p className="text-xs text-[#616161] dark:text-[#999] mb-3">Restore data from a previously exported JSON file.</p>
                <div className="flex flex-col gap-2 mb-3">
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
                    <div className="flex gap-2">
                        <Button id="admin-import-preview-btn" variant="secondary" size="sm" onClick={handlePreviewImport}>Preview</Button>
                        <Button id="admin-import-btn" size="sm" onClick={handleImport}>Import</Button>
                    </div>
                </div>
                {importPreview && (
                    <pre id="admin-import-preview" className="text-xs bg-black/5 dark:bg-white/5 p-2 rounded mb-2 whitespace-pre-wrap">{importPreview}</pre>
                )}
                {importStatus && <div id="admin-import-status" className="text-xs text-[#848484]">{importStatus}</div>}
            </Card>

            {/* Danger Zone */}
            <Card className="p-4 border-red-300 dark:border-red-800">
                <h3 className="text-sm font-semibold mb-2 text-red-600 dark:text-red-400">Danger Zone</h3>
                <p className="text-xs text-[#616161] dark:text-[#999] mb-3">Permanently delete all stored data. This cannot be undone.</p>
                <div className="flex items-center gap-2 mb-3">
                    <label className="flex items-center gap-1 text-xs">
                        <input id="admin-include-wikis" type="checkbox" checked={includeWikis} onChange={e => setIncludeWikis(e.target.checked)} className="accent-red-500" />
                        Include wikis
                    </label>
                </div>
                <div className="flex gap-2 mb-2">
                    <Button id="admin-preview-wipe" variant="secondary" size="sm" onClick={handlePreviewWipe}>Preview</Button>
                    {wipeToken === null ? (
                        <Button id="admin-wipe-btn" variant="danger" size="sm" onClick={handleWipeStep1}>Wipe Data</Button>
                    ) : (
                        <>
                            <Button id="admin-wipe-confirm" variant="danger" size="sm" onClick={handleWipeConfirm}>Confirm Wipe</Button>
                            <Button id="admin-wipe-cancel" variant="secondary" size="sm" onClick={handleWipeCancel}>Cancel</Button>
                        </>
                    )}
                </div>
                {wipePreview && (
                    <pre id="admin-wipe-preview" className="text-xs bg-black/5 dark:bg-white/5 p-2 rounded mb-2 whitespace-pre-wrap">{wipePreview}</pre>
                )}
                {wipeStatus && <div id="admin-wipe-status" className="text-xs text-[#848484]">{wipeStatus}</div>}
            </Card>

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
