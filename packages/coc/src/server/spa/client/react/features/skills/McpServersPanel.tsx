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
}

type SourceKey = keyof McpServerSources;

const SOURCE_LABELS: Record<SourceKey, { title: string; pathFallback: string; description: string; empty: string }> = {
    global: {
        title: 'Global MCP servers',
        pathFallback: '~/.copilot/mcp-config.json',
        description: 'Available to every CoC workspace unless a workspace server uses the same name.',
        empty: 'No global MCP servers configured.',
    },
    workspace: {
        title: 'Workspace MCP servers',
        pathFallback: '.vscode/mcp.json',
        description: 'Defined by this repository and preferred over global servers with the same name.',
        empty: 'No workspace MCP servers configured in .vscode/mcp.json.',
    },
};

function ServerSummary({ server }: { server: McpServerEntry }) {
    const summary = server.url ?? server.command;
    if (!summary) return null;
    return (
        <p className="text-xs text-[#848484] font-mono break-all mt-0.5">{summary}</p>
    );
}

function SourceCard({
    source,
    section,
    saving,
    loading,
    isEnabled,
    onToggle,
    useSourceTestIds,
}: {
    source: SourceKey;
    section: McpServerSourceSection;
    saving: boolean;
    loading: boolean;
    isEnabled: (name: string) => boolean;
    onToggle: (serverName: string, checked: boolean) => void;
    useSourceTestIds: boolean;
}) {
    const labels = SOURCE_LABELS[source];
    return (
        <section className="rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{labels.title}</h3>
                        <p className="text-[11px] text-[#848484] font-mono break-all mt-0.5">{section.configPath || labels.pathFallback}</p>
                    </div>
                    <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999]">
                        {section.servers.length} configured
                    </span>
                </div>
                <p className="text-xs text-[#616161] dark:text-[#999] mt-2">{labels.description}</p>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {section.servers.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">{labels.empty}</p>
                ) : section.servers.map((server) => {
                    const isOverridden = server.effective === false;
                    return (
                        <div key={`${source}-${server.name}`} className="flex items-center justify-between gap-4 px-4 py-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{server.name}</p>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded uppercase bg-[#f3f3f3] dark:bg-[#333] text-[#616161] dark:text-[#bbb]">
                                        {server.type}
                                    </span>
                                    {isOverridden && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                            Overridden by workspace
                                        </span>
                                    )}
                                </div>
                                <ServerSummary server={server} />
                            </div>
                            <label className={`relative inline-flex items-center ${isOverridden ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={!isOverridden && isEnabled(server.name)}
                                    disabled={saving || loading || isOverridden}
                                    onChange={(e) => onToggle(server.name, e.target.checked)}
                                    data-testid={useSourceTestIds ? `mcp-toggle-${source}-${server.name}` : `mcp-toggle-${server.name}`}
                                />
                                <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                            </label>
                        </div>
                    );
                })}
            </div>
        </section>
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
}: McpServersPanelProps) {
    const hasSourceSections = Boolean(sources);
    const legacySources: McpServerSources | undefined = sources ?? (availableServers.length > 0 ? {
        global: {
            configPath: '~/.copilot/mcp-config.json',
            fileExists: true,
            servers: availableServers,
        },
        workspace: {
            configPath: '.vscode/mcp.json',
            fileExists: false,
            servers: [],
        },
    } : undefined);

    return (
        <div className="space-y-4">
            {loading && <p className="text-sm text-gray-500">Loading…</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
            {!loading && !error && !legacySources && (
                <p className="text-sm text-gray-400">No MCP servers configured.</p>
            )}
            {!loading && legacySources && (
                <>
                    <SourceCard source="global" section={legacySources.global} saving={saving} loading={loading} isEnabled={isEnabled} onToggle={onToggle} useSourceTestIds={hasSourceSections} />
                    <SourceCard source="workspace" section={legacySources.workspace} saving={saving} loading={loading} isEnabled={isEnabled} onToggle={onToggle} useSourceTestIds={hasSourceSections} />
                </>
            )}
        </div>
    );
}
