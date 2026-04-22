/**
 * McpServersPanel — MCP server toggle panel extracted from RepoCopilotTab.
 */

export type McpServerEntry = { name: string; type: 'stdio' | 'sse' };

interface McpServersPanelProps {
    loading: boolean;
    error: string | null;
    saving: boolean;
    availableServers: McpServerEntry[];
    isEnabled: (name: string) => boolean;
    onToggle: (serverName: string, checked: boolean) => void;
}

export function McpServersPanel({
    loading,
    error,
    saving,
    availableServers,
    isEnabled,
    onToggle,
}: McpServersPanelProps) {
    return (
        <div className="space-y-4">
            {loading && <p className="text-sm text-gray-500">Loading…</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
            {!loading && !error && availableServers.length === 0 && (
                <p className="text-sm text-gray-400">No MCP servers configured.</p>
            )}
            {availableServers.map((server) => (
                <div key={server.name} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                    <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{server.name}</p>
                        <p className="text-xs text-gray-400 uppercase">{server.type}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isEnabled(server.name)}
                            disabled={saving || loading}
                            onChange={(e) => onToggle(server.name, e.target.checked)}
                            data-testid={`mcp-toggle-${server.name}`}
                        />
                        <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                    </label>
                </div>
            ))}
        </div>
    );
}
