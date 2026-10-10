/**
 * LlmToolsPanel — Per-repo LLM tools enable/disable settings panel.
 * Follows the same toggle pattern used by Agent Skills.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LlmToolMeta, LlmToolParam, LlmToolsConfig } from '@plusplusoneplusplus/coc-client';
import { useCocClient, useCloneBaseUrl } from '../../repos/cloneRouting';
import { invalidateRepoPreferences } from '../../api/repoPreferences';
import { getOrFetchConfig, peekConfig, invalidateConfig, configCacheKey } from '../../api/staticConfigCache';
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
    const cloneClient = useCocClient(workspaceId);
    const baseUrl = useCloneBaseUrl(workspaceId);
    // Seed from a warm per-workspace cache hit so a reopen paints without a
    // loading flash and without refetching (AC-01).
    const seed = peekConfig<LlmToolsConfig>(configCacheKey.llmToolsConfig(workspaceId, baseUrl));
    const [tools, setTools] = useState<LlmToolMeta[]>(seed?.tools ?? []);
    const [disabledTools, setDisabledTools] = useState<string[]>(seed?.disabledLlmTools ?? []);
    const [approvalTools, setApprovalTools] = useState<string[]>(seed?.approvalRequiredLlmTools ?? []);
    const [loading, setLoading] = useState(seed === undefined);
    const [saving, setSaving] = useState(false);
    const loadGenerationRef = useRef(0);

    const loadConfig = useCallback(() => {
        const generation = ++loadGenerationRef.current;
        const key = configCacheKey.llmToolsConfig(workspaceId, baseUrl);
        // Warm cache hit — apply synchronously without a loading flash (AC-01).
        const cached = peekConfig<LlmToolsConfig>(key);
        if (cached !== undefined) {
            setTools(cached.tools ?? []);
            setDisabledTools(cached.disabledLlmTools ?? []);
            setApprovalTools(cached.approvalRequiredLlmTools ?? []);
            setLoading(false);
            return;
        }
        setLoading(true);
        getOrFetchConfig(key, () => cloneClient.preferences.getLlmToolsConfig(workspaceId))
            .then((data: LlmToolsConfig) => {
                if (generation !== loadGenerationRef.current) return;
                setTools(data.tools ?? []);
                setDisabledTools(data.disabledLlmTools ?? []);
                setApprovalTools(data.approvalRequiredLlmTools ?? []);
            })
            .catch(() => {})
            .finally(() => {
                if (generation === loadGenerationRef.current) setLoading(false);
            });
    }, [workspaceId, cloneClient, baseUrl]);

    useEffect(() => {
        loadConfig();
        return () => { loadGenerationRef.current++; };
    }, [loadConfig]);

    const handleToggle = async (toolName: string, enabled: boolean) => {
        const nextDisabled = enabled
            ? disabledTools.filter(n => n !== toolName)
            : [...disabledTools, toolName];
        const prevDisabled = disabledTools;
        setDisabledTools(nextDisabled);
        setSaving(true);
        try {
            await cloneClient.preferences.updateLlmToolsConfig(
                workspaceId,
                { disabledLlmTools: nextDisabled },
            );
            // AC-05: drop the cached workspace config so other readers (e.g. the
            // chat conversation-retrieval check) refetch the changed config.
            invalidateConfig(configCacheKey.llmToolsConfig(workspaceId, baseUrl));
            invalidateRepoPreferences(cloneClient, workspaceId);
        } catch (e: any) {
            setDisabledTools(prevDisabled);
            addToast(e?.message ?? 'Failed to save LLM tools config', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleApprovalToggle = async (toolName: string, required: boolean) => {
        const nextApproval = required
            ? [...approvalTools.filter(n => n !== toolName), toolName]
            : approvalTools.filter(n => n !== toolName);
        const prevApproval = approvalTools;
        setApprovalTools(nextApproval);
        setSaving(true);
        try {
            await cloneClient.preferences.updateLlmToolsConfig(
                workspaceId,
                { approvalRequiredLlmTools: nextApproval },
            );
            invalidateConfig(configCacheKey.llmToolsConfig(workspaceId, baseUrl));
            invalidateRepoPreferences(cloneClient, workspaceId);
        } catch (e: any) {
            setApprovalTools(prevApproval);
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
                            <div className="pl-[46px] pr-2.5 pb-1.5 flex flex-col gap-1">
                                <ToolParams tool={tool} />
                                {tool.approvalGateable && (
                                    <label
                                        className={`inline-flex w-fit items-center gap-1.5 text-[10px] text-[#1e1e1e] dark:text-[#cccccc] ${enabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                                        title={enabled ? 'Ask before this tool runs on interactive turns' : 'Enable the tool to require approval'}
                                        data-testid={`llm-tool-approval-label-${tool.name}`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="h-3 w-3"
                                            checked={approvalTools.includes(tool.name)}
                                            onChange={e => handleApprovalToggle(tool.name, e.target.checked)}
                                            disabled={saving || !enabled}
                                            data-testid={`llm-tool-approval-toggle-${tool.name}`}
                                        />
                                        Require approval
                                    </label>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
