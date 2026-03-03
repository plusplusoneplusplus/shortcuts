/**
 * RepoCopilotTab — MCP server toggle panel for a workspace.
 */

import { useEffect, useState } from 'react';
import { fetchApi } from '../hooks/useApi';

interface RepoCopilotTabProps {
    workspaceId: string;
}

type McpServerEntry = { name: string; type: 'stdio' | 'sse' };

export function RepoCopilotTab({ workspaceId }: RepoCopilotTabProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [availableServers, setAvailableServers] = useState<McpServerEntry[]>([]);
    const [enabledMcpServers, setEnabledMcpServers] = useState<string[] | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchApi(`/workspaces/${workspaceId}/mcp-config`)
            .then((data) => {
                setAvailableServers(data.availableServers ?? []);
                setEnabledMcpServers(data.enabledMcpServers ?? null);
            })
            .catch((e: any) => setError(e.message ?? 'Failed to load MCP config'))
            .finally(() => setLoading(false));
    }, [workspaceId]);

    const isEnabled = (name: string) =>
        enabledMcpServers === null || enabledMcpServers.includes(name);

    const handleToggle = async (serverName: string, checked: boolean) => {
        const allNames = availableServers.map((s) => s.name);
        const currentList = enabledMcpServers ?? allNames;
        const nextList = checked
            ? [...new Set([...currentList, serverName])]
            : currentList.filter((n) => n !== serverName);
        const nextValue = nextList.length === allNames.length ? null : nextList;
        const prevValue = enabledMcpServers;
        setEnabledMcpServers(nextValue); // optimistic update
        setSaving(true);
        try {
            await fetchApi(`/workspaces/${workspaceId}/mcp-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabledMcpServers: nextValue }),
            });
        } catch (e: any) {
            setError(e.message ?? 'Failed to save');
            setEnabledMcpServers(prevValue); // revert on error
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                MCP Servers
            </h2>
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
                            onChange={(e) => handleToggle(server.name, e.target.checked)}
                            data-testid={`mcp-toggle-${server.name}`}
                        />
                        <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                    </label>
                </div>
            ))}
        </div>
    );
}
