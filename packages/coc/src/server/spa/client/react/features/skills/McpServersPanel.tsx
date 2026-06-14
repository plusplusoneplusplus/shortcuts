import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import './mcp-servers-redesign.css';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getApiBase } from '../../utils/config';
import type {
    McpServerDetail as ClientMcpServerDetail,
    McpConfigScope,
    McpServerAuthStatus,
    McpServerToolsResult,
    McpDiscoveredTool,
} from '@plusplusoneplusplus/coc-client';
import {
    isMcpToolEnabled,
    applyMcpToolToggle,
    enableAllMcpTools,
    disableAllMcpTools,
    normalizeEnabledMcpTools,
    type EnabledMcpToolsMap,
} from './mcpToolsAllowList';

type DiscoveryState = 'idle' | 'loading' | 'loaded' | 'error';

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
    /** Auth state for remote servers (absent on stdio). */
    authStatus?: McpServerAuthStatus;
    /** Token expiry (epoch seconds), when known. */
    authExpiresAt?: number;
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
    /**
     * Raw enabled-server allow-list. Needed so per-tool toggles can be persisted
     * through the same `PUT /mcp-config` call without clobbering the server list.
     */
    enabledMcpServers?: string[] | null;
    /** Initial per-repo enabled-tools allow-list (server → enabled tool names). */
    enabledMcpTools?: Record<string, string[]> | null;
    isEnabled: (name: string) => boolean;
    onToggle: (serverName: string, checked: boolean) => void;
    onRefresh?: () => void;
    /** Called after a server is added or deleted so the parent can refresh the list. */
    onMutate?: () => void;
}

type FilterTab = 'all' | 'active' | 'auth' | 'disabled';

type InspectorTab = 'overview' | 'tools' | 'configuration' | 'source' | 'activity';

/**
 * Local state for a server's OAuth flow. `starting` → `authorizing` → `completed`
 * (or `failed`). Stored only in the panel — server-side state lives in the
 * McpOauthManager and is fetched via `/api/mcp-oauth/pending/:id`.
 */
type McpAuthFlowState =
    | { phase: 'starting' }
    | { phase: 'authorizing'; requestId: string; authorizationUrl?: string }
    | { phase: 'completed'; requestId: string }
    | { phase: 'failed'; requestId: string; error: string };

const AUTH_POLL_INTERVAL_MS = 2_000;
const AUTH_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

/**
 * Resolve the dot color for a row.
 *
 * Trust the server-derived `status` field when present — it already accounts
 * for cached OAuth tokens. The legacy fallback (treat any HTTP/SSE server as
 * "auth") is kept for older responses that pre-date authStatus.
 */
function getServerStatus(server: McpServerEntry, isEnabled: boolean): 'ok' | 'auth' | 'off' | 'err' {
    if (!isEnabled) return 'off';
    if (server.status) return server.status;
    if (server.type === 'http' || server.type === 'sse') return 'auth';
    return 'ok';
}

function needsAuth(server: McpServerEntry): boolean {
    if (server.type !== 'http' && server.type !== 'sse') return false;
    if (!server.authStatus) return true; // legacy response — assume needs auth
    return server.authStatus === 'required' || server.authStatus === 'expired';
}

function isRemote(server: McpServerEntry): boolean {
    return server.type === 'http' || server.type === 'sse';
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

/** Collapsible JSON view of a tool's input schema (display-only). */
function ToolSchema({ schema }: { schema: unknown }) {
    const [open, setOpen] = useState(false);
    if (schema === undefined || schema === null) return null;
    let json: string;
    try {
        json = JSON.stringify(schema, null, 2);
    } catch {
        json = String(schema);
    }
    return (
        <div className="mcp-tool-schema">
            <button
                type="button"
                className="mcp-tool-schema-toggle"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
            >
                <span className={`mcp-tool-schema-chev${open ? ' open' : ''}`}><ChevronIcon /></span>
                {open ? 'Hide input schema' : 'Show input schema'}
            </button>
            {open && <pre className="mcp-source-pre mcp-tool-schema-pre">{json}</pre>}
        </div>
    );
}

function ToolRow({ tool, enabled, disabled, onToggle }: {
    tool: McpDiscoveredTool;
    enabled: boolean;
    disabled: boolean;
    onToggle: (enabled: boolean) => void;
}) {
    return (
        <div className={`mcp-tool-row${enabled ? '' : ' off'}`} data-tool={tool.name}>
            <div className="mcp-tool-head">
                <code className="mcp-tool-name">{tool.name}</code>
                <ToggleSwitch
                    checked={enabled}
                    disabled={disabled}
                    onChange={onToggle}
                    testId={`mcp-tool-toggle-${tool.name}`}
                />
            </div>
            {tool.description && <p className="mcp-tool-desc">{tool.description}</p>}
            <ToolSchema schema={tool.inputSchema} />
        </div>
    );
}

function InspectorToolsPane({
    enabled,
    result,
    discoveryState,
    discoveryError,
    allowEntry,
    saving,
    onToggleTool,
    onEnableAll,
    onDisableAll,
    onRefresh,
}: {
    enabled: boolean;
    result: McpServerToolsResult | undefined;
    discoveryState: DiscoveryState;
    discoveryError: string | null;
    allowEntry: string[] | undefined;
    saving: boolean;
    onToggleTool: (toolName: string, enabled: boolean) => void;
    onEnableAll: () => void;
    onDisableAll: () => void;
    onRefresh: () => void;
}) {
    const [query, setQuery] = useState('');

    if (!enabled) {
        return (
            <div className="mcp-empty-state" style={{ padding: '32px 0' }} data-testid="mcp-tools-disabled">
                Enable this server to discover its tools.
            </div>
        );
    }

    const loading = (discoveryState === 'loading' || discoveryState === 'idle') && !result;
    if (loading) {
        return (
            <div className="mcp-empty-state" style={{ padding: '32px 0' }} data-testid="mcp-tools-loading">
                Discovering tools…
            </div>
        );
    }

    const errorMsg = result?.status === 'error'
        ? (result.error || 'Connection failed')
        : (!result && discoveryState === 'error' ? (discoveryError || 'Discovery failed') : undefined);
    if (errorMsg) {
        return (
            <div className="mcp-tools-pane" data-testid="mcp-tools-error">
                <div className="mcp-empty-state" style={{ color: 'var(--mcp-danger)', padding: '20px 0' }}>
                    Couldn’t connect: {errorMsg}
                </div>
                <div style={{ textAlign: 'center' }}>
                    <button className="mcp-btn sm" type="button" onClick={onRefresh}>
                        <RefreshIcon14 /> Retry
                    </button>
                </div>
            </div>
        );
    }

    const tools = result?.status === 'ok' ? result.tools : [];
    const q = query.trim().toLowerCase();
    const filtered = q
        ? tools.filter(t => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
        : tools;
    const enabledCount = tools.filter(t => isMcpToolEnabled(allowEntry, t.name)).length;

    return (
        <div className="mcp-tools-pane" data-testid="mcp-tools-pane">
            <div className="mcp-tools-toolbar">
                <div className="mcp-search-wrap">
                    <SearchIcon14 />
                    <input
                        className="mcp-input"
                        type="text"
                        placeholder="Filter tools"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        data-testid="mcp-tools-search"
                    />
                </div>
                <span className="mcp-small" data-testid="mcp-tools-enabled-count">{enabledCount}/{tools.length} enabled</span>
                <div className="mcp-spacer" />
                <button
                    className="mcp-btn sm"
                    type="button"
                    disabled={saving || tools.length === 0}
                    onClick={onEnableAll}
                    data-testid="mcp-tools-enable-all"
                >
                    Enable all
                </button>
                <button
                    className="mcp-btn sm"
                    type="button"
                    disabled={saving || tools.length === 0}
                    onClick={onDisableAll}
                    data-testid="mcp-tools-disable-all"
                >
                    Disable all
                </button>
                <button className="mcp-btn sm" type="button" onClick={onRefresh} title="Re-discover tools" aria-label="Re-discover tools">
                    <RefreshIcon14 />
                </button>
            </div>
            {tools.length === 0 ? (
                <div className="mcp-empty-state" style={{ padding: '24px 0' }} data-testid="mcp-tools-empty">
                    This server exposes no tools.
                </div>
            ) : filtered.length === 0 ? (
                <div className="mcp-empty-state" style={{ padding: '24px 0' }}>
                    No tools matching “{query}”.
                </div>
            ) : (
                <div className="mcp-tool-list" data-testid="mcp-tool-list">
                    {filtered.map(tool => (
                        <ToolRow
                            key={tool.name}
                            tool={tool}
                            enabled={isMcpToolEnabled(allowEntry, tool.name)}
                            disabled={saving}
                            onToggle={(on) => onToggleTool(tool.name, on)}
                        />
                    ))}
                </div>
            )}
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

function ServerInspector({ server, activeTab, onTabChange, detail, workspaceId, onSaved, onDeleted, tools }: {
    server: McpServerEntry;
    activeTab: InspectorTab;
    onTabChange: (tab: InspectorTab) => void;
    detail: ClientMcpServerDetail | null | 'loading';
    workspaceId: string;
    onSaved: () => void;
    onDeleted: () => void;
    tools: {
        enabled: boolean;
        result: McpServerToolsResult | undefined;
        discoveryState: DiscoveryState;
        discoveryError: string | null;
        allowEntry: string[] | undefined;
        saving: boolean;
        onToggleTool: (toolName: string, enabled: boolean) => void;
        onEnableAll: () => void;
        onDisableAll: () => void;
        onRefresh: () => void;
    };
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
                {activeTab === 'tools' && (
                    <InspectorToolsPane
                        enabled={tools.enabled}
                        result={tools.result}
                        discoveryState={tools.discoveryState}
                        discoveryError={tools.discoveryError}
                        allowEntry={tools.allowEntry}
                        saving={tools.saving}
                        onToggleTool={tools.onToggleTool}
                        onEnableAll={tools.onEnableAll}
                        onDisableAll={tools.onDisableAll}
                        onRefresh={tools.onRefresh}
                    />
                )}
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

/**
 * Inline pill button next to a server name. Shows the auth call-to-action and
 * tracks the in-flight OAuth flow without needing a modal or extra navigation.
 *
 *   - No flow + needs auth   → "Authenticate"
 *   - starting               → "Starting…" (disabled)
 *   - authorizing            → "Authorizing…" with a re-open link
 *   - failed                 → "Try again" + error tooltip
 *   - completed (token good) → button collapses; status dot turns green on next refresh
 */
function AuthenticateButton({
    serverName,
    flow,
    authStatus,
    onClick,
}: {
    serverName: string;
    flow: McpAuthFlowState | undefined;
    authStatus: McpServerAuthStatus | undefined;
    onClick: () => void;
}) {
    const label = (() => {
        if (!flow) return authStatus === 'expired' ? 'Re-authenticate' : 'Authenticate';
        switch (flow.phase) {
            case 'starting': return 'Starting…';
            case 'authorizing': return 'Authorizing…';
            case 'completed': return 'Authorized';
            case 'failed': return 'Try again';
        }
    })();
    const disabled = !!flow && (flow.phase === 'starting' || flow.phase === 'authorizing' || flow.phase === 'completed');
    const className = `mcp-auth-btn${flow?.phase === 'failed' ? ' error' : ''}${flow?.phase === 'authorizing' ? ' busy' : ''}`;
    const error = flow?.phase === 'failed' ? flow.error : undefined;

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 10 }}>
            <button
                type="button"
                className={className}
                onClick={onClick}
                disabled={disabled}
                title={error}
                data-testid={`mcp-auth-${serverName}`}
                style={{
                    padding: '2px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 999,
                    border: '1px solid var(--mcp-border, #d0d7de)',
                    background: flow?.phase === 'failed' ? 'var(--mcp-danger-bg, #ffebe9)' : 'var(--mcp-accent-bg, rgba(0, 120, 212, 0.08))',
                    color: flow?.phase === 'failed' ? 'var(--mcp-danger, #cf222e)' : 'var(--mcp-accent, #0078d4)',
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled && flow?.phase !== 'authorizing' ? 0.7 : 1,
                }}
            >
                {label}
            </button>
            {flow?.phase === 'authorizing' && flow.authorizationUrl && (
                <a
                    href={flow.authorizationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: 'var(--mcp-accent, #0078d4)' }}
                >
                    Open again ↗
                </a>
            )}
            {error && (
                <span className="mcp-small" style={{ color: 'var(--mcp-danger, #cf222e)' }}>
                    {error}
                </span>
            )}
        </span>
    );
}

export function McpServersPanel({
    workspaceId = '',
    loading,
    error,
    saving,
    availableServers,
    sources,
    enabledMcpServers,
    enabledMcpTools,
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

    // ── Live tool discovery (AC-02) ──────────────────────────────────────────
    const [discovery, setDiscovery] = useState<Record<string, McpServerToolsResult>>({});
    const [discoveryState, setDiscoveryState] = useState<DiscoveryState>('idle');
    const [discoveryError, setDiscoveryError] = useState<string | null>(null);

    // ── Per-tool allow-list (AC-03) ──────────────────────────────────────────
    const [toolsAllowList, setToolsAllowList] = useState<EnabledMcpToolsMap>(() => ({ ...(enabledMcpTools ?? {}) }));
    const [toolsSaving, setToolsSaving] = useState(false);
    // Keep local allow-list in sync when the parent reloads the config.
    useEffect(() => {
        setToolsAllowList({ ...(enabledMcpTools ?? {}) });
    }, [enabledMcpTools]);

    const fetchTools = useCallback(async (forceReload = false) => {
        if (!workspaceId) return;
        setDiscoveryState('loading');
        setDiscoveryError(null);
        try {
            const resp = await getSpaCocClient().workspaces.discoverMcpTools(
                workspaceId,
                forceReload ? { forceReload: true } : undefined,
            );
            setDiscovery(resp.servers ?? {});
            setDiscoveryState('loaded');
        } catch (e) {
            setDiscoveryError(getSpaCocClientErrorMessage(e, 'Failed to discover tools'));
            setDiscoveryState('error');
        }
    }, [workspaceId]);

    // Eager discovery on mount / workspace change.
    useEffect(() => { void fetchTools(); }, [fetchTools]);

    const persistToolsAllowList = useCallback(async (nextMap: EnabledMcpToolsMap) => {
        if (!workspaceId) return;
        let prev: EnabledMcpToolsMap = {};
        setToolsAllowList(curr => { prev = curr; return nextMap; }); // optimistic
        setToolsSaving(true);
        try {
            await getSpaCocClient().workspaces.updateMcpConfig(workspaceId, {
                enabledMcpServers: enabledMcpServers ?? null,
                enabledMcpTools: normalizeEnabledMcpTools(nextMap),
            });
        } catch (e) {
            setToolsAllowList(prev); // revert
            setDiscoveryError(getSpaCocClientErrorMessage(e, 'Failed to save tool settings'));
        } finally {
            setToolsSaving(false);
        }
    }, [workspaceId, enabledMcpServers]);

    const discoveredToolNames = useCallback((serverName: string): string[] => {
        const r = discovery[serverName];
        return r && r.status === 'ok' ? r.tools.map(t => t.name) : [];
    }, [discovery]);

    const handleToolToggle = useCallback((serverName: string, toolName: string, on: boolean) => {
        void persistToolsAllowList(
            applyMcpToolToggle(toolsAllowList, serverName, discoveredToolNames(serverName), toolName, on),
        );
    }, [persistToolsAllowList, toolsAllowList, discoveredToolNames]);

    const handleEnableAllTools = useCallback((serverName: string) => {
        void persistToolsAllowList(enableAllMcpTools(toolsAllowList, serverName));
    }, [persistToolsAllowList, toolsAllowList]);

    const handleDisableAllTools = useCallback((serverName: string) => {
        void persistToolsAllowList(disableAllMcpTools(toolsAllowList, serverName));
    }, [persistToolsAllowList, toolsAllowList]);

    /** Row-level tool count label, e.g. "12", "8/12", "…", "!", or "—". */
    const toolCountFor = useCallback((server: McpServerEntry): { text: string; title?: string } => {
        if (!isEnabled(server.name) || server.effective === false) return { text: '—' };
        const r = discovery[server.name];
        if (!r) {
            return discoveryState === 'loading' || discoveryState === 'idle'
                ? { text: '…' }
                : { text: '—' };
        }
        if (r.status === 'error') return { text: '!', title: r.error };
        const total = r.tools.length;
        const enabledCount = r.tools.filter(t => isMcpToolEnabled(toolsAllowList[server.name], t.name)).length;
        return { text: enabledCount === total ? String(total) : `${enabledCount}/${total}`, title: `${enabledCount} of ${total} tools enabled` };
    }, [discovery, discoveryState, isEnabled, toolsAllowList]);
    /** Per-server OAuth flow state — drives the Authenticate button label and spinner. */
    const [authFlow, setAuthFlow] = useState<Record<string, McpAuthFlowState>>({});
    const authPollersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

    // Tear down any open pollers when the panel unmounts to avoid stray fetches.
    useEffect(() => () => {
        for (const t of Object.values(authPollersRef.current)) clearInterval(t);
        authPollersRef.current = {};
    }, []);

    const setFlow = useCallback((serverName: string, next: McpAuthFlowState | null) => {
        setAuthFlow(prev => {
            if (next === null) {
                if (!(serverName in prev)) return prev;
                const copy = { ...prev };
                delete copy[serverName];
                return copy;
            }
            return { ...prev, [serverName]: next };
        });
    }, []);

    const startPolling = useCallback((serverName: string, requestId: string) => {
        // Replace any existing poller for this server
        const existing = authPollersRef.current[serverName];
        if (existing) clearInterval(existing);

        const apiBase = getApiBase();
        const url = `${apiBase}/mcp-oauth/pending/${encodeURIComponent(requestId)}`;
        const startedAt = Date.now();

        const tick = async () => {
            try {
                const r = await fetch(url);
                if (r.ok) {
                    const entry = await r.json() as { status?: string; error?: string };
                    if (entry.status === 'completed') {
                        clearInterval(authPollersRef.current[serverName]);
                        delete authPollersRef.current[serverName];
                        setFlow(serverName, { phase: 'completed', requestId });
                        onRefresh?.();
                        return;
                    } else if (entry.status === 'failed') {
                        clearInterval(authPollersRef.current[serverName]);
                        delete authPollersRef.current[serverName];
                        setFlow(serverName, { phase: 'failed', requestId, error: entry.error ?? 'Authorization failed' });
                        return;
                    }
                }
            } catch {
                // transient network error — keep polling
            }
            // Always check timeout so a stuck/gone entry doesn't poll forever.
            if (Date.now() - startedAt > AUTH_POLL_TIMEOUT_MS) {
                clearInterval(authPollersRef.current[serverName]);
                delete authPollersRef.current[serverName];
                setFlow(serverName, { phase: 'failed', requestId, error: 'Authorization timed out' });
            }
        };

        authPollersRef.current[serverName] = setInterval(tick, AUTH_POLL_INTERVAL_MS);
    }, [onRefresh, setFlow]);

    const handleAuthenticate = useCallback(async (serverName: string) => {
        setFlow(serverName, { phase: 'starting' });
        try {
            const r = await fetch(`${getApiBase()}/mcp-oauth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverName, workspaceId: workspaceId || undefined }),
            });
            if (!r.ok) {
                const text = await r.text().catch(() => '');
                throw new Error(text || `Failed to start OAuth flow (${r.status})`);
            }
            const result = await r.json() as {
                requestId?: string;
                authorizationUrl?: string;
                alreadyAuthenticated?: boolean;
            };

            if (result.alreadyAuthenticated) {
                setFlow(serverName, { phase: 'completed', requestId: '' });
                onRefresh?.();
                return;
            }
            if (!result.requestId) {
                throw new Error('Server did not return a request id');
            }

            if (result.authorizationUrl) {
                window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
            }
            setFlow(serverName, {
                phase: 'authorizing',
                requestId: result.requestId,
                authorizationUrl: result.authorizationUrl,
            });
            startPolling(serverName, result.requestId);
        } catch (err) {
            setFlow(serverName, {
                phase: 'failed',
                requestId: '',
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, [onRefresh, setFlow, startPolling, workspaceId]);

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
        const authCount = allServers.filter(s => getServerStatus(s, isEnabled(s.name)) === 'auth').length;
        const disabled = allServers.filter(s => !isEnabled(s.name) || s.effective === false).length;
        return { all: allServers.length, active, auth: authCount, disabled };
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
                    <button
                        className="mcp-btn"
                        onClick={() => { onRefresh(); void fetchTools(true); }}
                        disabled={loading}
                        type="button"
                    >
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
                        const flow = authFlow[server.name];
                        const showAuthBtn = isRemote(server) && enabled && (needsAuth(server) || (flow && flow.phase !== 'completed'));
                        const toolCount = toolCountFor(server);

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
                                        {showAuthBtn && (
                                            <AuthenticateButton
                                                serverName={server.name}
                                                flow={flow}
                                                authStatus={server.authStatus}
                                                onClick={() => handleAuthenticate(server.name)}
                                            />
                                        )}
                                    </div>
                                    <div className="mcp-meta"><span className={`mcp-pill ${transportCls}`}>{server.type}</span></div>
                                    <div className="mcp-meta"><span className={`mcp-pill ${sourcePill.cls}`}>{sourcePill.label}</span></div>
                                    <div className="mcp-tools-count" title={toolCount.title} data-testid={`mcp-tools-count-${server.name}`}>{toolCount.text}</div>
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
                                        tools={{
                                            enabled: enabled && !isOverridden,
                                            result: discovery[server.name],
                                            discoveryState,
                                            discoveryError,
                                            allowEntry: toolsAllowList[server.name],
                                            saving: toolsSaving,
                                            onToggleTool: (toolName, on) => handleToolToggle(server.name, toolName, on),
                                            onEnableAll: () => handleEnableAllTools(server.name),
                                            onDisableAll: () => handleDisableAllTools(server.name),
                                            onRefresh: () => void fetchTools(true),
                                        }}
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
