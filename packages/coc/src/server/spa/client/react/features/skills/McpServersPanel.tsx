import React, { useState, useMemo, useCallback } from 'react';
import './mcp-servers-redesign.css';

export type McpServerSource = 'global' | 'workspace';
export type McpServerEntry = {
    name: string;
    type: string;
    url?: string;
    command?: string;
    source?: McpServerSource;
    effective?: boolean;
    overriddenBy?: McpServerSource;
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
    loading: boolean;
    error: string | null;
    saving: boolean;
    availableServers: McpServerEntry[];
    sources?: McpServerSources;
    isEnabled: (name: string) => boolean;
    onToggle: (serverName: string, checked: boolean) => void;
    onRefresh?: () => void;
}

type FilterTab = 'all' | 'active' | 'auth' | 'disabled';
type InspectorTab = 'overview' | 'tools' | 'configuration' | 'source' | 'activity';

// Mock descriptions for servers that only have a name/type from the API
const MOCK_DESCRIPTIONS: Record<string, string> = {
    github: 'Repo, issues, PRs, and Actions tools from github.com',
    filesystem: 'Read and search local files inside the repo working tree',
    linear: 'Linear issues and projects',
    sentry: 'Errors and performance data',
    postgres: 'Read-only access to the staging analytics database',
    slack: 'Post messages and read channels',
    notion: 'Search and read pages from the team workspace',
};

const MOCK_TOOL_COUNTS: Record<string, number> = {
    github: 38, filesystem: 6, linear: 14, sentry: 9, postgres: 4, slack: 7, notion: 11,
};

const MOCK_HEALTH: Record<string, { uptime: string; handshake: string; calls: string; errors: string }> = {
    github: { uptime: '4h 12m', handshake: '142 ms', calls: '1,284', errors: '3 (0.2%)' },
};

const MOCK_TOOLS: { name: string; desc: string; scope: 'read' | 'write'; calls: number; enabled: boolean }[] = [
    { name: 'search_repositories', desc: 'Search for GitHub repositories by name, owner, language, or topic.', scope: 'read', calls: 312, enabled: true },
    { name: 'get_file_contents', desc: 'Read the contents of a file or directory from a repository at a specific ref.', scope: 'read', calls: 284, enabled: true },
    { name: 'list_pull_requests', desc: 'List pull requests in a repository with filters for state, author, and base branch.', scope: 'read', calls: 196, enabled: true },
    { name: 'create_or_update_file', desc: 'Create or update a file in a repository. Requires write access to the target branch.', scope: 'write', calls: 84, enabled: true },
    { name: 'create_issue', desc: 'Open a new issue in a repository with title, body, labels, and assignees.', scope: 'write', calls: 42, enabled: true },
    { name: 'merge_pull_request', desc: 'Merge a pull request using the repository\'s configured merge method.', scope: 'write', calls: 12, enabled: false },
    { name: 'list_workflow_runs', desc: 'List GitHub Actions workflow runs filtered by status and branch.', scope: 'read', calls: 98, enabled: true },
];

const MOCK_ACTIVITY = [
    { time: '3 min ago', event: 'Tool call from code-review agent', tool: 'get_file_contents', result: '200', resultClass: 'ok' },
    { time: '8 min ago', event: 'Tool call from triage agent', tool: 'list_pull_requests', result: '200', resultClass: 'ok' },
    { time: '14 min ago', event: 'Server restart — config changed', tool: '—', result: 'info', resultClass: 'muted' },
    { time: '26 min ago', event: 'Tool call from code-review agent', tool: 'create_or_update_file', result: '201', resultClass: 'ok' },
    { time: '38 min ago', event: 'Rate-limit warning from upstream', tool: '—', result: '429', resultClass: 'warn' },
];

function getServerStatus(server: McpServerEntry, isEnabled: boolean): 'ok' | 'auth' | 'off' | 'err' {
    if (!isEnabled) return 'off';
    if (server.type === 'http' || server.type === 'sse') return 'auth';
    return 'ok';
}

function getServerDescription(server: McpServerEntry, status: string, isEnabled: boolean): string {
    const base = MOCK_DESCRIPTIONS[server.name] || server.url || server.command || '';
    if (!isEnabled) return `Disabled · ${base.toLowerCase()}`;
    if (status === 'auth') return base;
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

function InspectorOverviewPane({ server }: { server: McpServerEntry }) {
    const health = MOCK_HEALTH[server.name];
    const command = server.command || `npx -y @modelcontextprotocol/server-${server.name}`;
    return (
        <div className="mcp-overview-grid">
            <dl className="mcp-kv">
                <dt>Server name</dt><dd><code>{server.name}</code></dd>
                <dt>Description</dt><dd>{MOCK_DESCRIPTIONS[server.name] || '—'}</dd>
                <dt>Transport</dt><dd>{server.type}</dd>
                <dt>Command</dt><dd><code>{command}</code></dd>
                <dt>Source</dt><dd>{server.source === 'workspace' ? 'Repo config' : 'Global config'}</dd>
                <dt>Last started</dt><dd>3 minutes ago</dd>
            </dl>
            <div className="mcp-health">
                <h4>Health</h4>
                <div className="mcp-health-row">
                    <span className="mcp-label">Status</span>
                    <span className="mcp-val"><span className="mcp-pill ok">● Connected</span></span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Uptime</span>
                    <span className="mcp-val">{health?.uptime || '—'}</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Avg. handshake</span>
                    <span className="mcp-val">{health?.handshake || '—'}</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Tool calls (24h)</span>
                    <span className="mcp-val">{health?.calls || '—'}</span>
                </div>
                <div className="mcp-health-row">
                    <span className="mcp-label">Errors (24h)</span>
                    <span className="mcp-val">{health?.errors || '—'}</span>
                </div>
                <svg className="mcp-sparkline" viewBox="0 0 200 32" preserveAspectRatio="none">
                    <polyline fill="none" stroke="var(--mcp-success)" strokeWidth="1.5"
                        points="0,22 10,18 20,20 30,12 40,16 50,8 60,14 70,10 80,16 90,12 100,20 110,14 120,8 130,12 140,6 150,10 160,14 170,8 180,12 190,6 200,10" />
                    <polyline fill="rgba(31,136,61,0.08)" stroke="none"
                        points="0,32 0,22 10,18 20,20 30,12 40,16 50,8 60,14 70,10 80,16 90,12 100,20 110,14 120,8 130,12 140,6 150,10 160,14 170,8 180,12 190,6 200,10 200,32" />
                </svg>
                <div className="mcp-small">Tool calls over the last 24 hours</div>
            </div>
        </div>
    );
}

function InspectorToolsPane({ server }: { server: McpServerEntry }) {
    const toolCount = MOCK_TOOL_COUNTS[server.name] || 0;
    const remaining = Math.max(0, toolCount - MOCK_TOOLS.length);
    return (
        <div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <div className="mcp-search-wrap" style={{ maxWidth: 280 }}>
                    <SearchIcon14 />
                    <input className="mcp-input" type="text" placeholder="Filter tools" readOnly />
                </div>
                <div className="mcp-seg">
                    <button className="active">All {toolCount}</button>
                    <button>Read {Math.round(toolCount * 0.63)}</button>
                    <button>Write {Math.round(toolCount * 0.37)}</button>
                </div>
                <div className="mcp-spacer" />
                <span className="mcp-small">All tools enabled · <button className="mcp-link" type="button">disable all</button></span>
            </div>
            <table className="mcp-tools-table">
                <thead>
                    <tr>
                        <th style={{ width: '34%' }}>Tool</th>
                        <th>Description</th>
                        <th style={{ width: 90 }}>Scope</th>
                        <th style={{ width: 100, textAlign: 'right' }}>Calls (24h)</th>
                        <th style={{ width: 60 }}>Enabled</th>
                    </tr>
                </thead>
                <tbody>
                    {MOCK_TOOLS.map(tool => (
                        <tr key={tool.name}>
                            <td><div className="mcp-tool-name">{tool.name}</div></td>
                            <td className="mcp-tool-desc">{tool.desc}</td>
                            <td><span className={`mcp-scope-pill${tool.scope === 'write' ? ' write' : ''}`}>{tool.scope}</span></td>
                            <td className="mcp-calls">{tool.calls}</td>
                            <td><ToggleSwitch checked={tool.enabled} /></td>
                        </tr>
                    ))}
                    {remaining > 0 && (
                        <tr>
                            <td colSpan={5} style={{ textAlign: 'center' }}>
                                <button className="mcp-link mcp-small" type="button">Show {remaining} more tools</button>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function InspectorConfigPane({ server }: { server: McpServerEntry }) {
    return (
        <div>
            <div className="mcp-config-section">
                <h4>Environment variables</h4>
                <p className="mcp-help">Secrets are stored encrypted in the workspace keychain and never written to config files.</p>
                <table className="mcp-env-table">
                    <thead><tr><th style={{ width: '40%' }}>Key</th><th>Value</th><th style={{ width: 60 }} /></tr></thead>
                    <tbody>
                        <tr>
                            <td><span className="mcp-env-key">GITHUB_TOKEN</span></td>
                            <td><div className="mcp-env-val"><span className="mcp-secret">••••••••••••••••</span></div></td>
                            <td><button className="mcp-icon-btn" title="Remove" type="button">×</button></td>
                        </tr>
                    </tbody>
                </table>
                <button className="mcp-btn sm" style={{ marginTop: 10 }} type="button"><PlusIcon size={12} /> Add variable</button>
            </div>

            <div className="mcp-config-section">
                <h4>Command arguments</h4>
                <p className="mcp-help">Arguments passed to the server process. One per line.</p>
                <textarea className="mcp-input" readOnly defaultValue={`-y\n@modelcontextprotocol/server-${server.name}\n--read-only=false`} />
            </div>

            <div className="mcp-config-section">
                <h4>Allowed tools</h4>
                <p className="mcp-help">Restrict which tools agents may call from this server.</p>
                <div className="mcp-radio-group">
                    <label><input type="radio" name={`scope-${server.name}`} defaultChecked /> <span><strong>All tools</strong> <span className="mcp-sub">— {MOCK_TOOL_COUNTS[server.name] || 0} tools available</span></span></label>
                    <label><input type="radio" name={`scope-${server.name}`} /> <span><strong>Read-only</strong> <span className="mcp-sub">— hide tools tagged <code>write</code></span></span></label>
                    <label><input type="radio" name={`scope-${server.name}`} /> <span><strong>Allow-list</strong> <span className="mcp-sub">— specify tools individually in the Tools tab</span></span></label>
                </div>
            </div>

            <div className="mcp-config-section">
                <h4>Scope</h4>
                <p className="mcp-help">Where this configuration applies.</p>
                <div className="mcp-radio-group">
                    <label><input type="radio" name={`loc-${server.name}`} defaultChecked /> <span><strong>Workspace</strong> <span className="mcp-sub">— shared with collaborators via config file</span></span></label>
                    <label><input type="radio" name={`loc-${server.name}`} /> <span><strong>User</strong> <span className="mcp-sub">— only on this machine</span></span></label>
                </div>
            </div>

            <hr className="mcp-rule" />

            <div className="mcp-danger-zone">
                <h4>Remove server</h4>
                <p>Removing <code>{server.name}</code> will stop the process and delete its entry from the configuration. Stored secrets are deleted from the keychain.</p>
                <button className="mcp-btn danger-outline" type="button">Remove this server</button>
            </div>
        </div>
    );
}

function InspectorSourcePane({ server }: { server: McpServerEntry }) {
    const json = JSON.stringify({
        [server.name]: {
            command: server.command || 'npx',
            args: ['-y', `@modelcontextprotocol/server-${server.name}`, '--read-only=false'],
            env: { [`${server.name.toUpperCase()}_TOKEN`]: '${secrets.TOKEN}' },
            transport: server.type,
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
        <table className="mcp-tools-table">
            <thead>
                <tr>
                    <th style={{ width: 120 }}>Time</th>
                    <th>Event</th>
                    <th style={{ width: 120 }}>Tool</th>
                    <th style={{ width: 80 }}>Result</th>
                </tr>
            </thead>
            <tbody>
                {MOCK_ACTIVITY.map((a, i) => (
                    <tr key={i}>
                        <td className="mcp-small">{a.time}</td>
                        <td>{a.event}</td>
                        <td><span className="mcp-env-key">{a.tool}</span></td>
                        <td><span className={`mcp-pill ${a.resultClass}`}>{a.result}</span></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function ServerInspector({ server, activeTab, onTabChange }: {
    server: McpServerEntry;
    activeTab: InspectorTab;
    onTabChange: (tab: InspectorTab) => void;
}) {
    const toolCount = MOCK_TOOL_COUNTS[server.name] || 0;
    const tabs: { id: InspectorTab; label: string; badge?: string }[] = [
        { id: 'overview', label: 'Overview' },
        { id: 'tools', label: 'Tools', badge: String(toolCount) },
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
                        {tab.badge && <span className="mcp-badge">{tab.badge}</span>}
                    </button>
                ))}
            </div>
            <div className="mcp-inspector-body">
                {activeTab === 'overview' && <InspectorOverviewPane server={server} />}
                {activeTab === 'tools' && <InspectorToolsPane server={server} />}
                {activeTab === 'configuration' && <InspectorConfigPane server={server} />}
                {activeTab === 'source' && <InspectorSourcePane server={server} />}
                {activeTab === 'activity' && <InspectorActivityPane />}
            </div>
        </div>
    );
}

function AddServerCard() {
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
                        <button className="active">stdio (local process)</button>
                        <button>http (URL)</button>
                        <button>sse</button>
                    </div>
                </div>

                <div className="mcp-field-grid">
                    <div className="mcp-field">
                        <label htmlFor="srv-name">Server name</label>
                        <span className="mcp-field-hint">Lowercase, no spaces. Used as the key in the config.</span>
                        <input id="srv-name" className="mcp-input full" placeholder="e.g. github, postgres, internal-docs" readOnly />
                    </div>
                    <div className="mcp-field">
                        <label htmlFor="srv-desc">Description <span className="mcp-small" style={{ fontWeight: 400 }}>(optional)</span></label>
                        <span className="mcp-field-hint">Shown in this list and in the agent picker.</span>
                        <input id="srv-desc" className="mcp-input full" placeholder="e.g. Read access to the internal API docs site" readOnly />
                    </div>
                </div>

                <div className="mcp-field">
                    <label htmlFor="srv-cmd">Command</label>
                    <span className="mcp-field-hint">The executable to run. Use <code>npx -y &lt;package&gt;</code> for npm-published servers.</span>
                    <input id="srv-cmd" className="mcp-input full" placeholder="npx" defaultValue="npx" readOnly />
                </div>

                <div className="mcp-field">
                    <label htmlFor="srv-args">Arguments</label>
                    <span className="mcp-field-hint">One per line. Will be passed to the command.</span>
                    <textarea id="srv-args" className="mcp-input" placeholder={`-y\n@modelcontextprotocol/server-postgres\npostgres://readonly@db.example.com/app`} readOnly />
                </div>

                <div className="mcp-field">
                    <label>Environment variables</label>
                    <span className="mcp-field-hint">Secrets are stored in the workspace keychain.</span>
                    <table className="mcp-env-table">
                        <thead><tr><th style={{ width: '40%' }}>Key</th><th>Value</th><th style={{ width: 60 }} /></tr></thead>
                        <tbody>
                            <tr>
                                <td><input className="mcp-input" style={{ width: '100%', fontFamily: 'var(--mcp-font-mono)' }} placeholder="API_TOKEN" readOnly /></td>
                                <td><input className="mcp-input" style={{ width: '100%', fontFamily: 'var(--mcp-font-mono)' }} type="password" placeholder="paste secret" readOnly /></td>
                                <td><button className="mcp-icon-btn" title="Remove" type="button">×</button></td>
                            </tr>
                        </tbody>
                    </table>
                    <button className="mcp-btn sm" style={{ marginTop: 10 }} type="button"><PlusIcon size={12} /> Add variable</button>
                </div>

                <div className="mcp-field-grid">
                    <div className="mcp-field">
                        <label>Allowed tools</label>
                        <span className="mcp-field-hint">Restrict which tools this server can offer.</span>
                        <div className="mcp-radio-group">
                            <label><input type="radio" name="scope-new" defaultChecked /> <span><strong>All tools</strong> <span className="mcp-sub">— allow every tool the server exposes</span></span></label>
                            <label><input type="radio" name="scope-new" /> <span><strong>Read-only</strong> <span className="mcp-sub">— block tools tagged <code>write</code></span></span></label>
                            <label><input type="radio" name="scope-new" /> <span><strong>Pick after connect</strong> <span className="mcp-sub">— connect first, then choose</span></span></label>
                        </div>
                    </div>
                    <div className="mcp-field">
                        <label>Where should this be saved?</label>
                        <span className="mcp-field-hint">Workspace config is checked in and shared with collaborators.</span>
                        <div className="mcp-radio-group">
                            <label><input type="radio" name="loc-new" defaultChecked /> <span><strong>Workspace</strong> <span className="mcp-sub">— writes to the repo config file</span></span></label>
                            <label><input type="radio" name="loc-new" /> <span><strong>Just me</strong> <span className="mcp-sub">— writes to the user override file</span></span></label>
                        </div>
                    </div>
                </div>
            </div>
            <div className="mcp-form-actions">
                <button className="mcp-btn" type="button">Test connection</button>
                <button className="mcp-btn primary" type="button">Add server</button>
            </div>
        </div>
    );
}

export function McpServersPanel({
    loading,
    error,
    saving,
    availableServers,
    sources,
    isEnabled,
    onToggle,
    onRefresh,
}: McpServersPanelProps) {
    const [filterTab, setFilterTab] = useState<FilterTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');

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
        const active = allServers.filter(s => isEnabled(s.name) && s.effective !== false).length;
        const needsAuth = allServers.filter(s => {
            const status = getServerStatus(s, isEnabled(s.name));
            return status === 'auth';
        }).length;
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
                (MOCK_DESCRIPTIONS[s.name] || '').toLowerCase().includes(q)
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
        }
    }, [expandedServer]);

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
                        const description = getServerDescription(server, status, enabled);
                        const transportCls = getTransportPillClass(server.type);
                        const sourcePill = getSourcePillInfo(server);
                        const toolCount = MOCK_TOOL_COUNTS[server.name] || 0;
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
                                        <span className="mcp-server-desc">— {description}</span>
                                    </div>
                                    <div className="mcp-meta"><span className={`mcp-pill ${transportCls}`}>{server.type}</span></div>
                                    <div className="mcp-meta"><span className={`mcp-pill ${sourcePill.cls}`}>{sourcePill.label}</span></div>
                                    <div className="mcp-tools-count">{toolCount} tools</div>
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
                                    />
                                )}
                            </React.Fragment>
                        );
                    })
                )}
            </div>

            {/* Add server card */}
            <AddServerCard />

            {/* Footer */}
            <div className="mcp-footer">
                <p className="mcp-small">
                    Learn more about <button className="mcp-link" type="button">the Model Context Protocol</button> or browse the <button className="mcp-link" type="button">MCP server registry</button>.
                </p>
            </div>
        </div>
    );
}
