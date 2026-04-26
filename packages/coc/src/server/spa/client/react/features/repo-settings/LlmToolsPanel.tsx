/**
 * LlmToolsPanel — Per-repo LLM tools enable/disable settings panel.
 * Follows the same toggle pattern used by Agent Skills.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../hooks/useApi';
import { useGlobalToast } from '../../contexts/ToastContext';

interface LlmToolMeta {
    name: string;
    label: string;
    description: string;
    enabledByDefault: boolean;
}

interface LlmToolsConfigResponse {
    tools: LlmToolMeta[];
    disabledLlmTools: string[];
}

interface LlmToolsPanelProps {
    workspaceId: string;
}

export function LlmToolsPanel({ workspaceId }: LlmToolsPanelProps) {
    const { addToast } = useGlobalToast();
    const [tools, setTools] = useState<LlmToolMeta[]>([]);
    const [disabledTools, setDisabledTools] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadConfig = useCallback(() => {
        setLoading(true);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/llm-tools-config`)
            .then((data: LlmToolsConfigResponse) => {
                setTools(data.tools ?? []);
                setDisabledTools(data.disabledLlmTools ?? []);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [workspaceId]);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    const handleToggle = async (toolName: string, enabled: boolean) => {
        const nextDisabled = enabled
            ? disabledTools.filter(n => n !== toolName)
            : [...disabledTools, toolName];
        const prevDisabled = disabledTools;
        setDisabledTools(nextDisabled);
        setSaving(true);
        try {
            await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/llm-tools-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disabledLlmTools: nextDisabled }),
            });
        } catch (e: any) {
            setDisabledTools(prevDisabled);
            addToast(e?.message ?? 'Failed to save LLM tools config', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="text-xs text-[#848484]" data-testid="llm-tools-loading">Loading...</div>;
    }

    return (
        <div className="flex flex-col gap-3" data-testid="llm-tools-panel">
            <div>
                <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">LLM Tools</h2>
                <p className="text-xs text-[#848484] mt-0.5">
                    Toggle AI tools available during chat sessions for this repo.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1" data-testid="llm-tools-list">
                {tools.map(tool => {
                    const enabled = !disabledTools.includes(tool.name);
                    return (
                        <label
                            key={tool.name}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] cursor-pointer hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] transition-colors ${enabled ? '' : 'opacity-60'}`}
                            title={tool.description}
                            data-testid={`llm-tool-row-${tool.name}`}
                        >
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={enabled}
                                onChange={e => handleToggle(tool.name, e.target.checked)}
                                disabled={saving}
                                data-testid={`llm-tool-toggle-${tool.name}`}
                            />
                            <div className={`relative flex-shrink-0 w-7 h-4 rounded-full transition-colors ${
                                enabled ? 'bg-[#0078d4]' : 'bg-[#ccc] dark:bg-[#555]'
                            } ${saving ? 'opacity-50' : ''}`}>
                                <div className={`absolute top-[2px] w-3 h-3 rounded-full bg-white shadow transition-transform ${
                                    enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
                                }`} />
                            </div>
                            <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                {tool.label}
                            </span>
                            {!tool.enabledByDefault && (
                                <span className="flex-shrink-0 text-[9px] text-[#848484] bg-[#f3f3f3] dark:bg-[#333] px-1 rounded">
                                    off
                                </span>
                            )}
                        </label>
                    );
                })}
            </div>
        </div>
    );
}
