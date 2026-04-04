/**
 * WorkItemDetail — right-pane detail view for a selected work item.
 * Shows description, plan, execution history, and action buttons.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, Badge, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';

const STATUS_LABELS: Record<string, { label: string; badgeStatus: string }> = {
    created: { label: 'Created', badgeStatus: 'queued' },
    planning: { label: 'Planning', badgeStatus: 'warning' },
    ready: { label: 'Ready', badgeStatus: 'completed' },
    executing: { label: 'Executing', badgeStatus: 'running' },
    done: { label: 'Done', badgeStatus: 'completed' },
    failed: { label: 'Failed', badgeStatus: 'failed' },
};

interface WorkItemDetailProps {
    workItemId: string;
    workspaceId: string;
    onBack?: () => void;
    onExecuted?: () => void;
}

interface WorkItemFull {
    id: string; title: string; description: string; status: string;
    priority?: string; source: string; sourceId?: string;
    createdAt: string; updatedAt: string; completedAt?: string;
    plan?: { version: number; content: string; updatedAt: string; resolvedBy?: string };
    taskId?: string; processId?: string;
    executionHistory?: Array<{ taskId: string; processId?: string; startedAt: string; completedAt?: string; status: string; error?: string }>;
    tags?: string[];
    autoExecute?: boolean;
}

interface PlanVersion {
    version: number;
    createdAt: string;
    resolvedBy?: string;
    summary?: string;
}

export function WorkItemDetail({ workItemId, workspaceId, onBack, onExecuted }: WorkItemDetailProps) {
    const [item, setItem] = useState<WorkItemFull | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [executing, setExecuting] = useState(false);
    const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
    const [showPlanVersions, setShowPlanVersions] = useState(false);
    const [editingPlan, setEditingPlan] = useState(false);
    const [planDraft, setPlanDraft] = useState('');
    const [savingPlan, setSavingPlan] = useState(false);
    const [refineMode, setRefineMode] = useState(false);
    const [refineInstructions, setRefineInstructions] = useState('');
    const [refining, setRefining] = useState(false);
    const [refinedContent, setRefinedContent] = useState<string | null>(null);

    const basePath = `/workspaces/${encodeURIComponent(workspaceId)}/work-items/${encodeURIComponent(workItemId)}`;

    const fetchItem = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchApi(basePath);
            setItem(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load work item');
        } finally {
            setLoading(false);
        }
    }, [basePath]);

    useEffect(() => { fetchItem(); }, [fetchItem]);

    const handleExecute = async () => {
        setExecuting(true);
        try {
            await fetchApi(basePath + '/execute', { method: 'POST' });
            await fetchItem();
            onExecuted?.();
        } catch (err: any) {
            setError(err.message || 'Failed to execute');
        } finally {
            setExecuting(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        try {
            await fetchApi(basePath, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to update status');
        }
    };

    const handleSavePlan = async () => {
        setSavingPlan(true);
        try {
            await fetchApi(basePath + '/plan', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: planDraft }),
            });
            setEditingPlan(false);
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to save plan');
        } finally {
            setSavingPlan(false);
        }
    };

    const handleRefine = async () => {
        setRefining(true);
        try {
            const data = await fetchApi(basePath + '/plan/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instructions: refineInstructions.trim() || undefined }),
            });
            setRefinedContent(data.content ?? data.plan?.content ?? '');
            setRefineMode(false);
        } catch (err: any) {
            setError(err.message || 'Failed to refine plan');
        } finally {
            setRefining(false);
        }
    };

    const handleAcceptRefine = async () => {
        setRefinedContent(null);
        setRefineInstructions('');
        await fetchItem();
    };

    const handleRejectRefine = () => {
        setRefinedContent(null);
        setRefineInstructions('');
    };

    const loadPlanVersions = async () => {
        try {
            const data = await fetchApi(basePath + '/plan/versions');
            setPlanVersions(data || []);
            setShowPlanVersions(true);
        } catch { /* ignore */ }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-full text-sm text-[#848484]">Loading…</div>;
    }

    if (error && !item) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-red-500">
                <div className="text-center space-y-2">
                    <div>{error}</div>
                    <Button variant="ghost" size="sm" onClick={fetchItem}>Retry</Button>
                </div>
            </div>
        );
    }

    if (!item) return null;

    const statusCfg = STATUS_LABELS[item.status] || STATUS_LABELS.created;
    const canExecute = item.status === 'ready';
    const canEditPlan = ['created', 'planning', 'ready'].includes(item.status);

    return (
        <div className="flex flex-col h-full" data-testid="work-item-detail">
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#474749] flex items-center gap-2">
                {onBack && (
                    <button onClick={onBack} className="text-sm text-[#848484] hover:text-[#333] dark:hover:text-[#ccc]" data-testid="work-item-back-btn">
                        ←
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-medium truncate" title={item.title}>{item.title}</h2>
                    <div className="flex items-center gap-2 text-[10px] text-[#848484] dark:text-[#999] mt-0.5">
                        <Badge status={statusCfg.badgeStatus}>{statusCfg.label}</Badge>
                        {item.priority && item.priority !== 'normal' && (
                            <span className={cn('px-1.5 py-0.5 rounded text-[10px]',
                                item.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            )}>{item.priority}</span>
                        )}
                        {item.plan && <span>v{item.plan.version} plan</span>}
                        <span>·</span>
                        <span>{formatRelativeTime(item.updatedAt)}</span>
                    </div>
                </div>
                {canExecute && (
                    <Button variant="primary" size="sm" onClick={handleExecute} disabled={executing} loading={executing} data-testid="work-item-execute-btn">
                        ▶ Execute
                    </Button>
                )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {error && (
                    <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2">{error}</div>
                )}

                {/* Description */}
                <section>
                    <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Description</h3>
                    <div className="text-sm whitespace-pre-wrap">{item.description || 'No description'}</div>
                </section>

                {/* Source info */}
                <section>
                    <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Source</h3>
                    <div className="text-xs text-[#606060] dark:text-[#aaa]">
                        {item.source === 'manual' ? '✍️ Created manually' :
                         item.source === 'chat' ? `💬 From chat session${item.sourceId ? ` (${item.sourceId.slice(0, 8)}…)` : ''}` :
                         item.source === 'schedule' ? `📅 From schedule${item.sourceId ? ` (${item.sourceId})` : ''}` :
                         item.source}
                    </div>
                </section>

                {/* Plan section */}
                <section>
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase">
                            Plan {item.plan ? `(v${item.plan.version})` : ''}
                        </h3>
                        <div className="flex gap-1">
                            {item.plan && (
                                <Button variant="ghost" size="sm" onClick={loadPlanVersions} data-testid="work-item-plan-versions-btn">
                                    📜 History
                                </Button>
                            )}
                            {canEditPlan && !editingPlan && !refinedContent && (
                                <Button variant="ghost" size="sm" onClick={() => { setPlanDraft(item.plan?.content || ''); setEditingPlan(true); }} data-testid="work-item-plan-edit-btn">
                                    ✏️ {item.plan ? 'Edit' : 'Add Plan'}
                                </Button>
                            )}
                            {canEditPlan && !editingPlan && !refinedContent && (
                                <Button variant="ghost" size="sm" onClick={() => setRefineMode(!refineMode)} disabled={refining} loading={refining} data-testid="work-item-plan-refine-btn">
                                    🤖 Refine
                                </Button>
                            )}
                        </div>
                    </div>
                    {refineMode && !refinedContent && (
                        <div className="space-y-2 mb-2" data-testid="work-item-refine-input">
                            <input
                                type="text"
                                className="w-full text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e]"
                                placeholder="Optional instructions (e.g., &quot;make it more detailed&quot;)…"
                                value={refineInstructions}
                                onChange={e => setRefineInstructions(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleRefine(); } }}
                            />
                            <div className="flex gap-1">
                                <Button variant="primary" size="sm" onClick={handleRefine} disabled={refining} loading={refining}>Refine</Button>
                                <Button variant="ghost" size="sm" onClick={() => { setRefineMode(false); setRefineInstructions(''); }}>Cancel</Button>
                            </div>
                        </div>
                    )}
                    {refinedContent !== null && (
                        <div className="space-y-2 mb-2" data-testid="work-item-refine-result">
                            <div className="text-[10px] font-medium text-[#848484] uppercase">Refined Plan (preview)</div>
                            <div className="text-xs whitespace-pre-wrap font-mono bg-green-50 dark:bg-green-900/20 rounded p-2 border border-green-300 dark:border-green-700 max-h-64 overflow-y-auto">
                                {refinedContent}
                            </div>
                            <div className="flex gap-1">
                                <Button variant="primary" size="sm" onClick={handleAcceptRefine} data-testid="work-item-refine-accept">✅ Accept</Button>
                                <Button variant="ghost" size="sm" onClick={handleRejectRefine} data-testid="work-item-refine-reject">✕ Reject</Button>
                            </div>
                        </div>
                    )}
                    {editingPlan ? (
                        <div className="space-y-2">
                            <textarea
                                className="w-full h-48 text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] resize-y font-mono"
                                value={planDraft}
                                onChange={e => setPlanDraft(e.target.value)}
                                data-testid="work-item-plan-editor"
                            />
                            <div className="flex gap-1">
                                <Button variant="primary" size="sm" onClick={handleSavePlan} disabled={savingPlan} loading={savingPlan}>Save</Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditingPlan(false)}>Cancel</Button>
                            </div>
                        </div>
                    ) : item.plan ? (
                        <div className="text-xs whitespace-pre-wrap font-mono bg-[#fafafa] dark:bg-[#1e1e1e] rounded p-2 border border-[#e0e0e0] dark:border-[#474749] max-h-64 overflow-y-auto" data-testid="work-item-plan-content">
                            {item.plan.content}
                        </div>
                    ) : (
                        <div className="text-xs text-[#848484] italic">No plan yet</div>
                    )}

                    {/* Plan version history */}
                    {showPlanVersions && planVersions.length > 0 && (
                        <div className="mt-2 border border-[#e0e0e0] dark:border-[#474749] rounded p-2">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-medium text-[#848484] uppercase">Version History</span>
                                <button className="text-[10px] text-[#848484] hover:text-[#333]" onClick={() => setShowPlanVersions(false)}>✕</button>
                            </div>
                            {planVersions.map(v => (
                                <div key={v.version} className="flex items-center gap-2 text-[10px] py-0.5">
                                    <span className={cn('font-medium', v.version === item.plan?.version && 'text-[#0078d4]')}>
                                        v{v.version}
                                    </span>
                                    <span className="text-[#848484]">{formatRelativeTime(v.createdAt)}</span>
                                    {v.resolvedBy && <span className="text-[#848484]">by {v.resolvedBy}</span>}
                                    {v.summary && <span className="text-[#606060] truncate">{v.summary}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Status transitions */}
                <section>
                    <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Actions</h3>
                    <div className="flex flex-wrap gap-1">
                        {item.status === 'created' && (
                            <Button variant="ghost" size="sm" onClick={() => handleStatusChange('planning')}>🔍 Start Planning</Button>
                        )}
                        {item.status === 'planning' && (
                            <Button variant="ghost" size="sm" onClick={() => handleStatusChange('ready')}>✅ Mark Ready</Button>
                        )}
                        {(item.status === 'done' || item.status === 'failed') && (
                            <Button variant="ghost" size="sm" onClick={() => handleStatusChange('created')}>🔄 Reopen</Button>
                        )}
                        <Button variant="ghost" size="sm" className="text-red-500" onClick={async () => {
                            if (confirm('Delete this work item?')) {
                                await fetchApi(basePath, { method: 'DELETE' });
                                onBack?.();
                            }
                        }} data-testid="work-item-delete-btn">🗑 Delete</Button>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer mt-2" data-testid="work-item-auto-execute-toggle">
                        <input
                            type="checkbox"
                            checked={item.autoExecute ?? false}
                            onChange={async (e) => {
                                try {
                                    await fetchApi(basePath, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ autoExecute: e.target.checked }),
                                    });
                                    await fetchItem();
                                } catch (err: any) {
                                    setError(err.message || 'Failed to update auto-execute');
                                }
                            }}
                            className="rounded"
                        />
                        Auto-execute when ready
                    </label>
                </section>

                {/* Execution history */}
                {item.executionHistory && item.executionHistory.length > 0 && (
                    <section>
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Execution History</h3>
                        <div className="space-y-1">
                            {item.executionHistory.map((exec, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10px]">
                                    <span>{exec.status === 'running' ? '🔵' : exec.status === 'completed' ? '🟢' : exec.status === 'failed' ? '🔴' : '⚪'}</span>
                                    <span className="text-[#606060] dark:text-[#aaa]">Run #{i + 1}</span>
                                    <span className="text-[#848484]">{formatRelativeTime(exec.startedAt)}</span>
                                    {exec.error && <span className="text-red-500 truncate">{exec.error}</span>}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                    <section>
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Tags</h3>
                        <div className="flex flex-wrap gap-1">
                            {item.tags.map(tag => (
                                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#606060] dark:text-[#aaa]">{tag}</span>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
