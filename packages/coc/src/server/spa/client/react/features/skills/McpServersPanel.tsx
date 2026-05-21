import React, { useState, useMemo, useCallback, useEffect } from 'react';
import './mcp-servers-redesign.css';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { McpServerDetail as ClientMcpServerDetail, McpConfigScope } from '@plusplusoneplusplus/coc-client';

export type McpServerSource = 'global' | 'workspace';
export type McpServerEntry = {
    name: string;
    type: string;
    url?: string;
    command?: string;
    source?: McpServerSource;
    effective?: boolean;
    overriddenBy?: McpServerSource;
    /** Derived status from the server response. */
    status?: 'ok' | 'auth' | 'off' | 'err';
    /** User-provided description from config file. */
    description?: string;
};

export type McpServerSourceSection = {
    configPath: string;
    fileExists: boolean;
    success: boolean;
    error?: string;
    servers: McpServerEntry[];
};

export type McpServerSources = {
    global: McpServerSourceSection;
    workspace: McpServerSourceSection;
};

interface McpServersPanelProps {
    workspaceId?: string;
    loading: boolean;
    error: string | null;
    saving: boolean;
    availableServers: McpServerEntry[];
    sources?: McpServerSources;
    isEnabled: (name: string) => boolean;
    onToggle: (serverName: string, checked: boolean) => void;
    onRefresh?: () => void;
    /** Called after a server is added or deleted so the parent can refresh the list. */
    onMutate?: () => void;
}

type FilterTab = 'all' | 'active' | 'auth' | 'disabled';

type InspectorTab = 'overview' | 'tools' | 'configuration' | 'source' | 'activity';

function getServerStatus(server: McpServerEntry, isEnabled: boolean): 'ok' | 'auth' | 'off' | 'err' {
    if (!isEnabled) return 'off';
    if (server.type === 'http' || server.type === 'sse') return 'auth';
    return 'ok';
}

function getServerDescription(server: McpServerEntry, isEnabled: boolean): string {
    const base = server.description || server.url || server.command || '';
    if (!isEnabled) return `Disabled · ${base.toLowerCase()}`;
    return base;
}

function getTransportPillClass(type: string): string {
    if (type === 'stdio') return 'accent';
    if (type === 'http' || type === 'sse') return 'done';
    return '';
}

function getSourcePillInfo(server: McpServerEntry): { label: string; cls: string } {
    if (server.overriddenBy === 'workspace' || server.source === 'workspace') {
        return server.overriddenBy === 'workspace'
            ? { label: 'user override', cls: 'warn' }
            : { label: 'repo config', cls: 'muted' };
    }
    if (server.source === 'global') return { label: 'global', cls: 'muted' };
    return { label: 'repo config', cls: 'muted' };
}

function ChevronIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
    );
}

function SearchIcon14() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M10.68 11.74a6 6 0 0 1-7.92-8.62 6 6 0 0 1 8.62 7.92l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
        </svg>
    );
}

function RefreshIcon14() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M1.643 3.143.427 1.927A.25.25 0 0 0 0 2.104V5.75c0 .138.112.25.25.25h3.646a.25.25 0 0 0 .177-.427L2.715 4.215a6.5 6.5 0 1 1-1.18 4.458.75.75 0 1 0-1.493.154 8.001 8.001 0 1 0 1.6-5.684Z" />
        </svg>
    );
}

function PlusIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
        </svg>
    );
}

function ToggleSwitch({ checked, disabled, onChange, testId }: {
    checked: boolean;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
    testId?: string;
}) {
    return (
        <label className="mcp-switch">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange?.(e.target.checked)}
                data-testid={testId}
            />
            <span className="mcp-slider-bg" />
        </label>
    );
}

function SourcePathsCard({ sources }: { sources?: McpServerSources }) {
    const paths = useMemo(() => {
        const items: { label: string; file: string; meta: string }[] = [];
        if (sources?.workspace) {
            const ws = sources.workspace;
            items.push({
                label: 'Repo config',
                file: ws.configPath || '.vscode/mcp.json',
                meta: `${ws.servers.length} server${ws.servers.length !== 1 ? 's' : ''} · checked in`,
            });
        }
        if (sources?.global) {
            const gl = sources.global;
            items.push({
                label: 'User overrides',
                file: gl.configPath || '~/.copilot/mcp-config.json',
                meta: `${gl.servers.length} server${gl.servers.length !== 1 ? 's' : ''} · local only · not committed`,
            });
        }
        return items;
    }, [sources]);

    if (paths.length === 0) return null;

    return (
        <div className="mcp-paths">
            <div className="mcp-paths-header">
                <span>Configuration sources</span>
                <span className="mcp-hint">{paths.length} file{paths.length !== 1 ? 's' : ''}</span>
            </div>
            {paths.map((p) => (
                <div className="mcp-path-row" key={p.label}>
                    <div className="mcp-path-label">{p.label}</div>
                    <div className="mcp-path-body">
                        <div className="mcp-path-file">{p.file}</div>
                        <div className="mcp-path-meta">{p.meta}</div>
                    </div>
                    <button className="mcp-path-open" type="button">Open file →</button>
                </div>
            ))}
        </div>
    );
}

function InspectorOverviewPane({ server, detail }: { server: McpServerEntry; detail: ClientMcpServerDetail | null | 'loading' }) {
    const command = server.command || server.url || `npx -y @modelcontextprotocol/server-${server.name}`;
    const description = (detail && detail !== 'loading') ? detail.description : (server.description ?? '—');
    const source = (detail && detail !== 'loading') ? detail.source : (server.source ?? '—');
    return (
        <div className="mcp-overview-grid">
            <dl className="mcp-kv">
                <dt>Server name</dt><dd><code>{server.name}</code></dd>
                <dt>Description</dt><dd>{detail === 'loading' ? <span className="mcp-small">Loading…</span> : (description || '—')}</dd>
                <dt>Transport</dt><dd>{server.type}</dd>
                <dt>Command</dt><dd><code>{command}</code></dd>
                <dt>Source</dt><dd>{source === 'workspace' ? 'Repo config' : source === 'global' ? 'Global config' : '—'}</dd>
            </dl>
            <div className="mcp-health">
                <h4>Health</h4>
                <div className="mcp-health-row">
                    <span className="mcp-label">Status</span>
                    <span className="mcp-val">—</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Uptime</span>
                    <span className="mcp-val">—</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Avg. handshake</span>
                    <span className="mcp-val">—</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Tool calls (24h)</span>
                    <span className="mcp-val">—</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Errors (24h)</span>
                    <span className="mcp-val">—</span>
                </div>
                <div className="mcp-small">Health metrics coming soon</div>
            </div>
        </div>
    );
}

function InspectorToolsPane() {
    return (
        <div className="mcp-empty-state" style={{ padding: '32px 0' }}>
            Connect to view tools
        </div>
    );
}

function InspectorConfigPane({ server, detail, workspaceId, onSaved, onDeleted }: {
    server: McpServerEntry;
    detail: ClientMcpServerDetail | null | 'loading';
    workspaceId: string;
    onSaved: () => void;
    onDeleted: () => void;
}) {
    const loaded = detail && detail !== 'loading' ? detail : null;

    // Args state
    const [argsText, setArgsText] = useState('');
    const [argsSaving, setArgsSaving] = useState(false);
    const [argsError, setArgsError] = useState('');

    // Env state
    const [newEnvKey, setNewEnvKey] = useState('');
    const [newEnvValue, setNewEnvValue] = useState('');
    const [envSaving, setEnvSaving] = useState(false);
    const [envError, setEnvError] = useState('');

    // Tool scope state
    const [toolScope, setToolScope] = useState<'all' | 'readonly' | 'allowlist'>('all');
    const [scopeSaving, setScopeSaving] = useState(false);

    // Config scope state
    const [configScope, setConfigScope] = useState<McpServerSource>('workspace');
    const [migrateSaving, setMigrateSaving] = useState(false);

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleteSaving, setDeleteSaving] = useState(false);

    // Initialize from detail when loaded
    useEffect(() => {
        if (loaded) {
            setArgsText(loaded.args.join('\n'));
            setToolScope(loaded.toolScope);
            setConfigScope(loaded.source as McpServerSource);
        }
    }, [loaded]);

    const handleSaveArgs = async () => {
        if (!workspaceId) return;
        setArgsSaving(true);
        setArgsError('');
        try {
            const args = argsText.split('\n').map(s => s.trim()).filter(Boolean);
            await getSpaCocClient().workspaces.updateMcpServer(workspaceId, server.name, { args });
            onSaved();
        } catch (e) {
            setArgsError(getSpaCocClientErrorMessage(e, 'Failed to save args'));
        } finally {
            setArgsSaving(false);
        }
    };

    const handleSaveToolScope = async (scope: 'all' | 'readonly' | 'allowlist') => {
        if (!workspaceId) return;
        setToolScope(scope);
        setScopeSaving(true);
        try {
            await getSpaCocClient().workspaces.updateMcpServer(workspaceId, server.name, { toolScope: scope });
            onSaved();
        } catch {
            // revert
            if (loaded) setToolScope(loaded.toolScope);
        } finally {
            setScopeSaving(false);
        }
    };

    const handleMigrate = async (targetScope: 'global' | 'workspace') => {
        if (!workspaceId) return;
        const prevScope = configScope;
        setConfigScope(targetScope);
        setMigrateSaving(true);
        try {
            await getSpaCocClient().workspaces.migrateMcpServer(workspaceId, server.name, targetScope as McpConfigScope);
            onSaved();
        } catch {
            setConfigScope(prevScope);
        } finally {
            setMigrateSaving(false);
        }
    };

    const handleAddEnvVar = async () => {
        if (!workspaceId || !newEnvKey.trim()) return;
        setEnvSaving(true);
        setEnvError('');
        try {
            await getSpaCocClient().workspaces.updateMcpServer(workspaceId, server.name, {
                env: { [newEnvKey.trim()]: newEnvValue },
            });
            setNewEnvKey('');
            setNewEnvValue('');
            onSaved();
        } catch (e) {
            setEnvError(getSpaCocClientErrorMessage(e, 'Failed to add env var'));
        } finally {
            setEnvSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!workspaceId) return;
        setDeleteSaving(true);
        try {
            await getSpaCocClient().workspaces.deleteMcpServer(workspaceId, server.name);
            onDeleted();
        } catch {
            setDeleteConfirm(false);
        } finally {
            setDeleteSaving(false);
        }
    };

    return (
        <div>
            <div className="mcp-config-section">
                <h4>Environment variables</h4>
                <p className="mcp-help">Values are stored in the config file. Use secrets/env references for sensitive values.</p>
                {detail === 'loading' ? (
                    <div className="mcp-small">Loading…</div>
                ) : (
                    <>
                        <table className="mcp-env-table">
                            <thead><tr><th style={{ width: '40%' }}>Key</th><th>Value</th></tr></thead>
                            <tbody>
                                {(loaded?.envKeys ?? []).map(key => (
                                    <tr key={key}>
                                        <td><span className="mcp-env-key">{key}</span></td>
                                        <td><div className="mcp-env-val"><span className="mcp-secret">••••••••</span></div></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                className="mcp-input"
                                style={{ fontFamily: 'var(--mcp-font-mono)', width: 160 }}
                                placeholder="KEY"
                                value={newEnvKey}
                                onChange={e => setNewEnvKey(e.target.value)}
                            />
                            <input
                                className="mcp-input"
                                style={{ fontFamily: 'var(--mcp-font-mono)', width: 180 }}
                                type="password"
                                placeholder="value"
                                value={newEnvValue}
                                onChange={e => setNewEnvValue(e.target.value)}
                            />
                            <button
                                className="mcp-btn sm"
                                type="button"
                                disabled={!newEnvKey.trim() || envSaving}
                                onClick={handleAddEnvVar}
                            >
                                <PlusIcon size={12} /> Add
                            </button>
                        </div>
                        {envError && <div className="mcp-small" style={{ color: 'var(--mcp-danger)', marginTop: 4 }}>{envError}</div>}
                    </>
                )}
            </div>

            <div className="mcp-config-section">
                <h4>Command arguments</h4>
                <p className="mcp-help">Arguments passed to the server process. One per line.</p>
                {detail === 'loading' ? (
                    <div className="mcp-small">Loading…</div>
                ) : (
                    <>
                        <textarea
                            className="mcp-input"
                            value={argsText}
                            onChange={e => setArgsText(e.target.value)}
                            placeholder="One argument per line"
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                            <button
                                className="mcp-btn sm"
                                type="button"
                                disabled={argsSaving}
                                onClick={handleSaveArgs}
                            >
                                {argsSaving ? 'Saving…' : 'Save args'}
                            </button>
                            {argsError && <span className="mcp-small" style={{ color: 'var(--mcp-danger)' }}>{argsError}</span>}
                        </div>
                    </>
                )}
            </div>

            <div className="mcp-config-section">
                <h4>Allowed tools</h4>
                <p className="mcp-help">Restrict which tools agents may call from this server.</p>
                {detail === 'loading' ? (
                    <div className="mcp-small">Loading…</div>
                ) : (
                    <div className="mcp-radio-group">
                        <label>
                            <input
                                type="radio"
                                name={`scope-${server.name}`}
                                checked={toolScope === 'all'}
                                disabled={scopeSaving}
                                onChange={() => handleSaveToolScope('all')}
                            />
                            {' '}<span><strong>All tools</strong></span>
                        </label>
                        <label>
                            <input
                                type="radio"
                                name={`scope-${server.name}`}
                                checked={toolScope === 'readonly'}
                                disabled={scopeSaving}
                                onChange={() => handleSaveToolScope('readonly')}
                            />
                            {' '}<span><strong>Read-only</strong> <span className="mcp-sub">— hide tools tagged <code>write</code></span></span>
                        </label>
                        <label>
                            <input
                                type="radio"
                                name={`scope-${server.name}`}
                                checked={toolScope === 'allowlist'}
                                disabled={scopeSaving}
                                onChange={() => handleSaveToolScope('allowlist')}
                            />
                            {' '}<span><strong>Allow-list</strong> <span className="mcp-sub">— specify tools individually</span></span>
                        </label>
                    </div>
                )}
            </div>

            <div className="mcp-config-section">
                <h4>Scope</h4>
                <p className="mcp-help">Where this configuration applies.</p>
                {detail === 'loading' ? (
                    <div className="mcp-small">Loading…</div>
                ) : (
                    <div className="mcp-radio-group">
                        <label>
                            <input
                                type="radio"
                                name={`loc-${server.name}`}
                                checked={configScope === 'workspace'}
                                disabled={migrateSaving}
                                onChange={() => handleMigrate('workspace')}
                            />
                            {' '}<span><strong>Workspace</strong> <span className="mcp-sub">— shared via config file</span></span>
                        </label>
                        <label>
                            <input
                                type="radio"
                                name={`loc-${server.name}`}
                                checked={configScope === 'global'}
                                disabled={migrateSaving}
                                onChange={() => handleMigrate('global')}
                            />
                            {' '}<span><strong>User</strong> <span className="mcp-sub">— only on this machine</span></span>
                        </label>
                    </div>
                )}
            </div>

            <hr className="mcp-rule" />

            <div className="mcp-danger-zone">
                <h4>Remove server</h4>
                <p>Removing <code>{server.name}</code> will delete its entry from the configuration file.</p>
                {deleteConfirm ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="mcp-small">Are you sure?</span>
                        <button
                            className="mcp-btn danger-outline"
                            type="button"
                            disabled={deleteSaving}
                            onClick={handleDelete}
                        >
                            {deleteSaving ? 'Removing…' : 'Yes, remove'}
                        </button>
                        <button className="mcp-btn" type="button" onClick={() => setDeleteConfirm(false)}>Cancel</button>
                    </div>
                ) : (
                    <button
                        className="mcp-btn danger-outline"
                        type="button"
                        onClick={() => setDeleteConfirm(true)}
                    >
                        Remove this server
                    </button>
                )}
            </div>
        </div>
    );
}

function InspectorSourcePane({ server, detail }: { server: McpServerEntry; detail: ClientMcpServerDetail | null | 'loading' }) {
    if (detail === 'loading') {
        return <div className="mcp-small" style={{ marginTop: 8 }}>Loading…</div>;
    }
    const json = detail
        ? JSON.stringify({ [server.name]: detail.rawJson }, null, 2)
        : JSON.stringify({
            [server.name]: {
                command: server.command || 'npx',
                type: server.type,
                ...(server.url ? { url: server.url } : {}),
            },
        }, null, 2);
    return (
        <div>
            <p className="mcp-small" style={{ marginTop: 0 }}>This is the raw JSON as stored in the config file.</p>
            <pre className="mcp-source-pre">{json}</pre>
        </div>
    );
}

function InspectorActivityPane() {
    return (
        <div className="mcp-empty-state" style={{ padding: '32px 0' }}>
            Activity logging coming soon
        </div>
    );
}

function ServerInspector({ server, activeTab, onTabChange, detail, workspaceId, onSaved, onDeleted }: {
    server: McpServerEntry;
    activeTab: InspectorTab;
    onTabChange: (tab: InspectorTab) => void;
    detail: ClientMcpServerDetail | null | 'loading';
    workspaceId: string;
    onSaved: () => void;
    onDeleted: () => void;
}) {
    const tabs: { id: InspectorTab; label: string }[] = [
        { id: 'overview', label: 'Overview' },
        { id: 'tools', label: 'Tools' },
        { id: 'configuration', label: 'Configuration' },
        { id: 'source', label: 'Source' },
        { id: 'activity', label: 'Activity' },
    ];

    return (
        <div className="mcp-inspector">
            <div className="mcp-inspector-head">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`mcp-inspector-tab${activeTab === tab.id ? ' active' : ''}`}
                        onClick={() => onTabChange(tab.id)}
                        type="button"
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="mcp-inspector-body">
                {activeTab === 'overview' && <InspectorOverviewPane server={server} detail={detail} />}
                {activeTab === 'tools' && <InspectorToolsPane />}
                {activeTab === 'configuration' && (
                    <InspectorConfigPane
                        server={server}
                        detail={detail}
                        workspaceId={workspaceId}
                        onSaved={onSaved}
                        onDeleted={onDeleted}
                    />
                )}
                {activeTab === 'source' && <InspectorSourcePane server={server} detail={detail} />}
                {activeTab === 'activity' && <InspectorActivityPane />}
            </div>
        </div>
    );
}

function AddServerCard({ workspaceId, onAdded }: { workspaceId?: string; onAdded?: () => void }) {
    const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio');
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [command, setCommand] = useState('npx');
    const [argsText, setArgsText] = useState('');
    const [url, setUrl] = useState('');
    const [toolScope, setToolScope] = useState<'all' | 'readonly'>('all');
    const [scope, setScope] = useState<'workspace' | 'global'>('workspace');
    const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleAddEnvRow = () => setEnvRows(prev => [...prev, { key: '', value: '' }]);
    const handleEnvChange = (idx: number, field: 'key' | 'value', val: string) => {
        setEnvRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
    };
    const handleRemoveEnvRow = (idx: number) => setEnvRows(prev => prev.filter((_, i) => i !== idx));

    const handleAdd = async () => {
        if (!workspaceId || !name.trim()) return;
        setSaving(true);
        setError('');
        try {
            const envObj: Record<string, string> = {};
            for (const row of envRows) {
                if (row.key.trim()) envObj[row.key.trim()] = row.value;
            }
            await getSpaCocClient().workspaces.addMcpServer(workspaceId, {
                name: name.trim(),
                type: transport,
                command: transport === 'stdio' ? (command.trim() || undefined) : undefined,
                url: (transport === 'http' || transport === 'sse') ? (url.trim() || undefined) : undefined,
                args: transport === 'stdio' ? argsText.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
                env: Object.keys(envObj).length > 0 ? envObj : undefined,
                description: desc.trim() || undefined,
                toolScope: toolScope !== 'all' ? toolScope : undefined,
                scope,
            });
            // Reset form
            setName(''); setDesc(''); setCommand('npx'); setArgsText(''); setUrl('');
            setEnvRows([{ key: '', value: '' }]); setToolScope('all'); setScope('workspace');
            onAdded?.();
        } catch (e) {
            setError(getSpaCocClientErrorMessage(e, 'Failed to add server'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mcp-add-card" id="add">
            <div className="mcp-add-head">
                <PlusIcon size={16} />
                <h3>Connect a new MCP server</h3>
                <span className="mcp-small">Pick a transport, point it at a command or URL, and add the secrets it needs.</span>
            </div>
            <div className="mcp-add-body">
                <div className="mcp-field">
                    <label>Transport</label>
                    <span className="mcp-field-hint">How the agent talks to this server.</span>
                    <div className="mcp-seg">
                        {(['stdio', 'http', 'sse'] as const).map(t => (
                            <button
                                key={t}
                                className={transport === t ? 'active' : ''}
                                type="button"
                                onClick={() => setTransport(t)}
                            >
                                {t === 'stdio' ? 'stdio (local process)' : t}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mcp-field-grid">
                    <div className="mcp-field">
                        <label htmlFor="srv-name">Server name</label>
                        <span className="mcp-field-hint">Lowercase, no spaces. Used as the key in the config.</span>
                        <input
                            id="srv-name"
                            className="mcp-input full"
                            placeholder="e.g. github, postgres, internal-docs"
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>
                    <div className="mcp-field">
                        <label htmlFor="srv-desc">Description <span className="mcp-small" style={{ fontWeight: 400 }}>(optional)</span></label>
                        <span className="mcp-field-hint">Shown in this list and in the agent picker.</span>
                        <input
                            id="srv-desc"
                            className="mcp-input full"
                            placeholder="e.g. Read access to the internal API docs site"
                            value={desc}
                            onChange={e => setDesc(e.target.value)}
                        />
                    </div>
                </div>

                {transport === 'stdio' ? (
                    <>
                        <div className="mcp-field">
                            <label htmlFor="srv-cmd">Command</label>
                            <span className="mcp-field-hint">The executable to run.</span>
                            <input
                                id="srv-cmd"
                                className="mcp-input full"
                                placeholder="npx"
                                value={command}
                                onChange={e => setCommand(e.target.value)}
                            />
                        </div>
                        <div className="mcp-field">
                            <label htmlFor="srv-args">Arguments</label>
                            <span className="mcp-field-hint">One per line.</span>
                            <textarea
                                id="srv-args"
                                className="mcp-input"
                                placeholder={`-y\n@modelcontextprotocol/server-postgres\npostgres://readonly@db.example.com/app`}
                                value={argsText}
                                onChange={e => setArgsText(e.target.value)}
                            />
                        </div>
                    </>
                ) : (
                    <div className="mcp-field">
                        <label htmlFor="srv-url">URL</label>
                        <span className="mcp-field-hint">The endpoint URL for the MCP server.</span>
                        <input
                            id="srv-url"
                            className="mcp-input full"
                            placeholder="https://mcp.example.com/api"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                        />
                    </div>
                )}

                <div className="mcp-field">
                    <label>Environment variables</label>
                    <span className="mcp-field-hint">Passed to the server process.</span>
                    <table className="mcp-env-table">
                        <thead><tr><th style={{ width: '40%' }}>Key</th><th>Value</th><th style={{ width: 60 }} /></tr></thead>
                        <tbody>
                            {envRows.map((row, i) => (
                                <tr key={i}>
                                    <td>
                                        <input
                                            className="mcp-input"
                                            style={{ width: '100%', fontFamily: 'var(--mcp-font-mono)' }}
                                            placeholder="API_TOKEN"
                                            value={row.key}
                                            onChange={e => handleEnvChange(i, 'key', e.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="mcp-input"
                                            style={{ width: '100%', fontFamily: 'var(--mcp-font-mono)' }}
                                            type="password"
                                            placeholder="paste secret"
                                            value={row.value}
                                            onChange={e => handleEnvChange(i, 'value', e.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <button
                                            className="mcp-icon-btn"
                                            title="Remove"
                                            type="button"
                                            onClick={() => handleRemoveEnvRow(i)}
                                        >×</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <button className="mcp-btn sm" style={{ marginTop: 10 }} type="button" onClick={handleAddEnvRow}>
                        <PlusIcon size={12} /> Add variable
                    </button>
                </div>

                <div className="mcp-field-grid">
                    <div className="mcp-field">
                        <label>Allowed tools</label>
                        <span className="mcp-field-hint">Restrict which tools this server can offer.</span>
                        <div className="mcp-radio-group">
                            <label>
                                <input
                                    type="radio"
                                    name="scope-new"
                                    checked={toolScope === 'all'}
                                    onChange={() => setToolScope('all')}
                                />
                                {' '}<span><strong>All tools</strong></span>
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="scope-new"
                                    checked={toolScope === 'readonly'}
                                    onChange={() => setToolScope('readonly')}
                                />
                                {' '}<span><strong>Read-only</strong></span>
                            </label>
                        </div>
                    </div>
                    <div className="mcp-field">
                        <label>Where should this be saved?</label>
                        <span className="mcp-field-hint">Workspace config is checked in and shared with collaborators.</span>
                        <div className="mcp-radio-group">
                            <label>
                                <input
                                    type="radio"
                                    name="loc-new"
                                    checked={scope === 'workspace'}
                                    onChange={() => setScope('workspace')}
                                />
                                {' '}<span><strong>Workspace</strong> <span className="mcp-sub">— writes to the repo config file</span></span>
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="loc-new"
                                    checked={scope === 'global'}
                                    onChange={() => setScope('global')}
                                />
                                {' '}<span><strong>Just me</strong> <span className="mcp-sub">— writes to the user override file</span></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            {error && <div className="mcp-small" style={{ color: 'var(--mcp-danger)', padding: '0 16px 8px' }}>{error}</div>}
            <div className="mcp-form-actions">
                <button
                    className="mcp-btn primary"
                    type="button"
                    disabled={!name.trim() || saving || !workspaceId}
                    onClick={handleAdd}
                >
                    {saving ? 'Adding…' : 'Add server'}
                </button>
            </div>
        </div>
    );
}

export function McpServersPanel({
    workspaceId = '',
    loading,
    error,
    saving,
    availableServers,
    sources,
    isEnabled,
    onToggle,
    onRefresh,
    onMutate,
}: McpServersPanelProps) {
    const [filterTab, setFilterTab] = useState<FilterTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
    const [detailCache, setDetailCache] = useState<Record<string, ClientMcpServerDetail | null | 'loading'>>({});

    const fetchDetail = useCallback(async (name: string) => {
        if (!workspaceId || detailCache[name] !== undefined) return;
        setDetailCache(prev => ({ ...prev, [name]: 'loading' }));
        try {
            const detail = await getSpaCocClient().workspaces.getMcpServerDetail(workspaceId, name);
            setDetailCache(prev => ({ ...prev, [name]: detail }));
        } catch {
            setDetailCache(prev => ({ ...prev, [name]: null }));
        }
    }, [workspaceId, detailCache]);

    const legacySources: McpServerSources | undefined = sources ?? (availableServers.length > 0 ? {
        global: {
            configPath: '~/.copilot/mcp-config.json',
            fileExists: true,
            success: true,
            servers: availableServers,
        },
        workspace: {
            configPath: '.vscode/mcp.json',
            fileExists: false,
            success: true,
            servers: [],
        },
    } : undefined);

    const allServers = availableServers;

    const counts = useMemo(() => {
        const active = allServers.filter(s => isEnabled(s.name) && s.effective !== false && getServerStatus(s, true) === 'ok').length;
        const needsAuth = allServers.filter(s => getServerStatus(s, isEnabled(s.name)) === 'auth').length;
        const disabled = allServers.filter(s => !isEnabled(s.name) || s.effective === false).length;
        return { all: allServers.length, active, auth: needsAuth, disabled };
    }, [allServers, isEnabled]);

    const filteredServers = useMemo(() => {
        let list = allServers;

        if (filterTab === 'active') {
            list = list.filter(s => isEnabled(s.name) && s.effective !== false && getServerStatus(s, true) === 'ok');
        } else if (filterTab === 'auth') {
            list = list.filter(s => getServerStatus(s, isEnabled(s.name)) === 'auth');
        } else if (filterTab === 'disabled') {
            list = list.filter(s => !isEnabled(s.name) || s.effective === false);
        }

        const q = searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                (s.description ?? '').toLowerCase().includes(q)
            );
        }

        return list;
    }, [allServers, filterTab, searchQuery, isEnabled]);

    const handleToggleExpand = useCallback((name: string) => {
        if (expandedServer === name) {
            setExpandedServer(null);
        } else {
            setExpandedServer(name);
            setInspectorTab('overview');
            fetchDetail(name);
        }
    }, [expandedServer, fetchDetail]);

    // After a detail-mutating save, invalidate the cached detail so it re-fetches on next open
    const handleDetailSaved = useCallback((serverName: string) => {
        setDetailCache(prev => {
            const next = { ...prev };
            delete next[serverName];
            return next;
        });
    }, []);

    const handleServerDeleted = useCallback(() => {
        setExpandedServer(null);
        onMutate?.();
        onRefresh?.();
    }, [onMutate, onRefresh]);

    if (loading) {
        return (
            <div className="mcp-servers-redesign">
                <div className="mcp-page-header">
                    <h2 className="mcp-page-title">MCP servers</h2>
                </div>
                <div className="mcp-empty-state">Loading…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="mcp-servers-redesign">
                <div className="mcp-page-header">
                    <h2 className="mcp-page-title">MCP servers</h2>
                </div>
                <div className="mcp-empty-state" style={{ color: 'var(--mcp-danger)' }}>{error}</div>
            </div>
        );
    }

    return (
        <div className="mcp-servers-redesign" data-testid="mcp-servers-panel">
            <div className="mcp-page-header">
                <h2 className="mcp-page-title">MCP servers</h2>
            </div>

            {/* Configuration sources */}
            <SourcePathsCard sources={legacySources} />

            {/* Toolbar */}
            <div className="mcp-toolbar">
                <div className="mcp-seg" role="tablist">
                    {([
                        ['all', `All ${counts.all}`],
                        ['active', `Active ${counts.active}`],
                        ['auth', `Needs auth ${counts.auth}`],
                        ['disabled', `Disabled ${counts.disabled}`],
                    ] as [FilterTab, string][]).map(([tab, label]) => (
                        <button
                            key={tab}
                            className={filterTab === tab ? 'active' : ''}
                            onClick={() => setFilterTab(tab)}
                            type="button"
                        >
                            {label.split(' ').slice(0, -1).join(' ')}{' '}
                            <span className="mcp-small">{label.split(' ').pop()}</span>
                        </button>
                    ))}
                </div>
                <div className="mcp-search-wrap">
                    <SearchIcon14 />
                    <input
                        className="mcp-input"
                        type="text"
                        placeholder="Find a server"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="mcp-spacer" />
                {onRefresh && (
                    <button className="mcp-btn" onClick={onRefresh} disabled={loading} type="button">
                        <RefreshIcon14 /> Refresh status
                    </button>
                )}
                <a className="mcp-btn primary" href="#add">
                    <PlusIcon /> New server
                </a>
            </div>

            {/* Server list */}
            <div className="mcp-server-list" data-testid="mcp-server-list">
                {filteredServers.length === 0 ? (
                    <div className="mcp-empty-state">
                        {searchQuery ? `No servers matching "${searchQuery}"` : 'No MCP servers configured.'}
                    </div>
                ) : (
                    filteredServers.map(server => {
                        const enabled = isEnabled(server.name);
                        const isOverridden = server.effective === false;
                        const status = getServerStatus(server, enabled);
                        const description = getServerDescription(server, enabled);
                        const transportCls = getTransportPillClass(server.type);
                        const sourcePill = getSourcePillInfo(server);
                        const isExpanded = expandedServer === server.name;

                        return (
                            <React.Fragment key={server.name}>
                                <div
                                    className={`mcp-row-server${isExpanded ? ' expanded' : ''}`}
                                    data-name={server.name}
                                >
                                    <button
                                        className="mcp-chev"
                                        onClick={() => handleToggleExpand(server.name)}
                                        type="button"
                                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${server.name}`}
                                    >
                                        <ChevronIcon />
                                    </button>
                                    <div className="mcp-name-cell">
                                        <span className={`mcp-dot ${status}`} title={status} />
                                        <strong className="mcp-server-name" style={!enabled ? { color: 'var(--mcp-fg-muted)' } : undefined}>
                                            {server.name}
                                        </strong>
                                        {description && <span className="mcp-server-desc">— {description}</span>}
                                    </div>
                                    <div className="mcp-meta"><span className={`mcp-pill ${transportCls}`}>{server.type}</span></div>
                                    <div className="mcp-meta"><span className={`mcp-pill ${sourcePill.cls}`}>{sourcePill.label}</span></div>
                                    <div className="mcp-tools-count">—</div>
                                    <ToggleSwitch
                                        checked={!isOverridden && enabled}
                                        disabled={saving || isOverridden}
                                        onChange={(checked) => onToggle(server.name, checked)}
                                        testId={`mcp-toggle-${server.name}`}
                                    />
                                </div>
                                {isExpanded && (
                                    <ServerInspector
                                        server={server}
                                        activeTab={inspectorTab}
                                        onTabChange={setInspectorTab}
                                        detail={detailCache[server.name] ?? null}
                                        workspaceId={workspaceId}
                                        onSaved={() => handleDetailSaved(server.name)}
                                        onDeleted={handleServerDeleted}
                                    />
                                )}
                            </React.Fragment>
                        );
                    })
                )}
            </div>

            {/* Add server card */}
            <AddServerCard
                workspaceId={workspaceId}
                onAdded={() => {
                    onMutate?.();
                    onRefresh?.();
                }}
            />

            {/* Footer */}
            <div className="mcp-footer">
                <p className="mcp-small">
                    Learn more about <button className="mcp-link" type="button">the Model Context Protocol</button> or browse the <button className="mcp-link" type="button">MCP server registry</button>.
                </p>
            </div>
        </div>
    );
}
