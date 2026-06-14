/**
 * LlmToolsPanel — Per-repo LLM tools enable/disable settings panel.
 * Follows the same toggle pattern used by Agent Skills.
 */

import { useState, useEffect, useCallback } from 'react';
import type { LlmToolMeta, LlmToolParam, LlmToolsConfig } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';
import { useGlobalToast } from '../../contexts/ToastContext';

interface LlmToolsPanelProps {
    workspaceId: string;
}

/**
 * Render one compact parameter token: `name: type*` for required params and
 * `name?: type` for optional ones. The `type` is already a compact label such
 * as a primitive, `{...}` (nested object) or `[...]` (array), so nested shapes
 * stay collapsed.
 */
function formatParam(param: LlmToolParam): string {
    return `${param.name}${param.required ? '' : '?'}: ${param.type}${param.required ? '*' : ''}`;
}

/**
 * Compact, inline-expandable parameter summary for a single tool. Lives outside
 * the toggle <label> so activating it never flips the enable/disable checkbox.
 * Renders a small empty-state for tools with no params (`[]`) or no schema
 * (`undefined`) instead of a blank row.
 */
function ToolParams({ tool }: { tool: LlmToolMeta }) {
    const [expanded, setExpanded] = useState(false);
    const params = tool.params;

    if (params === undefined) {
        return (
            <span
                className="text-[10px] italic text-[#848484]"
                data-testid={`llm-tool-params-empty-${tool.name}`}
            >
                Parameters unavailable
            </span>
        );
    }

    if (params.length === 0) {
        return (
            <span
                className="text-[10px] italic text-[#848484]"
                data-testid={`llm-tool-params-empty-${tool.name}`}
            >
                No parameters
            </span>
        );
    }

    const panelId = `llm-tool-params-panel-${tool.name}`;
    const count = params.length;

    return (
        <div className="flex flex-col gap-0.5">
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-label={`${tool.label}: ${count} parameter${count === 1 ? '' : 's'}`}
                className="inline-flex w-fit items-center gap-1 rounded text-[10px] text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]"
                data-testid={`llm-tool-params-toggle-${tool.name}`}
            >
                <span
                    aria-hidden="true"
                    className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}
                >
                    ▸
                </span>
                {count} parameter{count === 1 ? '' : 's'}
            </button>
            {expanded && (
                <div
                    id={panelId}
                    className="flex flex-wrap gap-x-2 gap-y-0.5"
                    data-testid={`llm-tool-params-${tool.name}`}
                >
                    {params.map(param => (
                        <code
                            key={param.name}
                            className="font-mono text-[10px] leading-tight text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid={`llm-tool-param-${tool.name}-${param.name}`}
                        >
                            {formatParam(param)}
                        </code>
                    ))}
                </div>
            )}
        </div>
    );
}

export function LlmToolsPanel({ workspaceId }: LlmToolsPanelProps) {
    const { addToast } = useGlobalToast();
    const [tools, setTools] = useState<LlmToolMeta[]>([]);
    const [disabledTools, setDisabledTools] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadConfig = useCallback(() => {
        setLoading(true);
        getSpaCocClient().preferences.getLlmToolsConfig(workspaceId)
            .then((data: LlmToolsConfig) => {
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
            await getSpaCocClient().preferences.updateLlmToolsConfig(
                workspaceId,
                { disabledLlmTools: nextDisabled },
            );
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1" data-testid="llm-tools-list">
                {tools.map(tool => {
                    const enabled = !disabledTools.includes(tool.name);
                    return (
                        <div
                            key={tool.name}
                            className={`rounded border border-[#e0e0e0] dark:border-[#3c3c3c] transition-colors ${enabled ? '' : 'opacity-60'}`}
                            data-testid={`llm-tool-row-${tool.name}`}
                        >
                            <label
                                className="flex items-start gap-2 px-2.5 py-1.5 rounded-t cursor-pointer hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] transition-colors"
                                data-testid={`llm-tool-label-${tool.name}`}
                            >
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={enabled}
                                    onChange={e => handleToggle(tool.name, e.target.checked)}
                                    disabled={saving}
                                    data-testid={`llm-tool-toggle-${tool.name}`}
                                />
                                <div className={`relative flex-shrink-0 w-7 h-4 mt-0.5 rounded-full transition-colors ${
                                    enabled ? 'bg-[#0078d4]' : 'bg-[#ccc] dark:bg-[#555]'
                                } ${saving ? 'opacity-50' : ''}`}>
                                    <div className={`absolute top-[2px] w-3 h-3 rounded-full bg-white shadow transition-transform ${
                                        enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
                                    }`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                            {tool.label}
                                        </span>
                                        {!tool.enabledByDefault && (
                                            <span className="flex-shrink-0 text-[9px] text-[#848484] bg-[#f3f3f3] dark:bg-[#333] px-1 rounded">
                                                off
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] leading-tight text-[#848484] mt-0.5 line-clamp-2">{tool.description}</p>
                                </div>
                            </label>
                            <div className="pl-[46px] pr-2.5 pb-1.5">
                                <ToolParams tool={tool} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
