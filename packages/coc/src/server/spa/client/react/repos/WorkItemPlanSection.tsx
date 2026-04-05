/**
 * WorkItemPlanSection — plan viewer with version tabs, inline editing,
 * comments/feedback, and AI-assisted resolve.
 *
 * Version tabs let users browse all historical plan versions (read-only).
 * The current version is editable. Users can leave comments/feedback
 * and click "Resolve with AI" to create a new refined version that
 * addresses those comments.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';

interface PlanVersionMeta {
    version: number;
    createdAt: string;
    resolvedBy?: string;
    summary?: string;
}

interface PlanVersionFull extends PlanVersionMeta {
    content: string;
}

interface WorkItemPlanSectionProps {
    workspaceId: string;
    workItemId: string;
    /** Current plan attached to the work item (already loaded). */
    plan?: { version: number; content: string; updatedAt: string; resolvedBy?: string };
    /** Whether the user can edit / refine the plan (based on work item status). */
    canEdit: boolean;
    /** Called after any plan mutation so the parent can refresh. */
    onUpdated: () => void;
    onError: (msg: string) => void;
}

export function WorkItemPlanSection({
    workspaceId, workItemId, plan, canEdit, onUpdated, onError,
}: WorkItemPlanSectionProps) {
    const basePath = `/workspaces/${encodeURIComponent(workspaceId)}/work-items/${encodeURIComponent(workItemId)}/plan`;

    const [versions, setVersions] = useState<PlanVersionMeta[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [loadingVersion, setLoadingVersion] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [planDraft, setPlanDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [comments, setComments] = useState('');
    const [resolving, setResolving] = useState(false);
    const [resolvePreview, setResolvePreview] = useState<string | null>(null);
    const [accepting, setAccepting] = useState(false);

    const currentVersion = plan?.version ?? null;

    // Load version metadata list
    const loadVersions = useCallback(async () => {
        if (!plan) return;
        try {
            const data: PlanVersionMeta[] = await fetchApi(basePath + '/versions');
            setVersions(data || []);
        } catch { /* ignore */ }
    }, [basePath, plan]);

    useEffect(() => { loadVersions(); }, [loadVersions]);

    // When plan changes externally, reset to current version
    useEffect(() => {
        setSelectedVersion(null);
        setSelectedContent(null);
        setEditMode(false);
        setResolvePreview(null);
        setComments('');
    }, [plan?.version]);

    const handleSelectVersion = async (v: number) => {
        if (v === currentVersion) {
            setSelectedVersion(null);
            setSelectedContent(null);
            return;
        }
        setSelectedVersion(v);
        setLoadingVersion(true);
        try {
            const data: PlanVersionFull = await fetchApi(`${basePath}/versions/${v}`);
            setSelectedContent(data.content ?? '');
        } catch {
            onError('Failed to load plan version');
        } finally {
            setLoadingVersion(false);
        }
    };

    const displayedContent = selectedVersion !== null ? (selectedContent ?? '') : (plan?.content ?? '');
    const isCurrentSelected = selectedVersion === null || selectedVersion === currentVersion;

    // Save edited plan
    const handleSave = async () => {
        setSaving(true);
        try {
            await fetchApi(basePath, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: planDraft }),
            });
            setEditMode(false);
            onUpdated();
            loadVersions();
        } catch (err: any) {
            onError(err.message || 'Failed to save plan');
        } finally {
            setSaving(false);
        }
    };

    // Resolve comments with AI — creates new plan version
    const handleResolveWithAI = async () => {
        if (!comments.trim()) {
            onError('Add at least one comment before resolving with AI');
            return;
        }
        setResolving(true);
        try {
            const data = await fetchApi(basePath + '/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instructions: comments.trim() }),
            });
            setResolvePreview(data.plan?.content ?? data.content ?? '');
        } catch (err: any) {
            onError(err.message || 'Failed to refine plan');
        } finally {
            setResolving(false);
        }
    };

    const handleAcceptResolve = async () => {
        setAccepting(true);
        setResolvePreview(null);
        setComments('');
        await onUpdated();
        await loadVersions();
        setAccepting(false);
    };

    if (!plan) {
        return (
            <div className="space-y-2">
                <div className="text-xs text-[#848484] italic">No plan yet.</div>
                {canEdit && (
                    <Button variant="ghost" size="sm"
                        onClick={() => { setPlanDraft(''); setEditMode(true); }}
                        data-testid="work-item-plan-add-btn">
                        ✏️ Add Plan
                    </Button>
                )}
                {editMode && (
                    <PlanEditor
                        draft={planDraft}
                        onChange={setPlanDraft}
                        onSave={handleSave}
                        onCancel={() => setEditMode(false)}
                        saving={saving}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3" data-testid="work-item-plan-section">
            {/* Version tabs */}
            {versions.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                    {versions.map(v => {
                        const isCurrent = v.version === currentVersion;
                        const isSelected = selectedVersion === null ? isCurrent : selectedVersion === v.version;
                        return (
                            <button
                                key={v.version}
                                onClick={() => handleSelectVersion(v.version)}
                                title={[
                                    isCurrent ? 'Current' : '',
                                    v.resolvedBy ? `by ${v.resolvedBy}` : '',
                                    v.createdAt ? formatRelativeTime(v.createdAt) : '',
                                    v.summary ? `— ${v.summary}` : '',
                                ].filter(Boolean).join(' ')}
                                className={cn(
                                    'text-[10px] px-2 py-0.5 rounded border transition-colors',
                                    isSelected
                                        ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                        : 'border-[#d0d0d0] dark:border-[#555] text-[#606060] dark:text-[#aaa] hover:border-[#0078d4] hover:text-[#0078d4]'
                                )}
                                data-testid={`plan-version-tab-${v.version}`}
                            >
                                v{v.version}{isCurrent ? ' ·' : ''}
                                {v.resolvedBy === 'ai' ? ' 🤖' : ''}
                            </button>
                        );
                    })}
                    {versions.length > 0 && !isCurrentSelected && (
                        <span className="text-[10px] text-[#848484] italic ml-1">
                            {versions.find(v => v.version === selectedVersion)?.summary
                                ? `"${versions.find(v => v.version === selectedVersion)!.summary}"`
                                : 'Read-only snapshot'}
                        </span>
                    )}
                </div>
            )}

            {/* Plan content */}
            {editMode && isCurrentSelected ? (
                <PlanEditor
                    draft={planDraft}
                    onChange={setPlanDraft}
                    onSave={handleSave}
                    onCancel={() => setEditMode(false)}
                    saving={saving}
                />
            ) : (
                <div className="relative">
                    {loadingVersion ? (
                        <div className="text-xs text-[#848484] py-4 text-center">Loading version…</div>
                    ) : (
                        <div
                            className={cn(
                                'text-xs whitespace-pre-wrap font-mono rounded p-3 border max-h-72 overflow-y-auto',
                                isCurrentSelected
                                    ? 'bg-[#fafafa] dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#474749]'
                                    : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                            )}
                            data-testid="work-item-plan-content"
                        >
                            {displayedContent || <span className="italic text-[#848484]">Empty plan</span>}
                        </div>
                    )}
                    {/* Edit / action buttons (current version only) */}
                    {isCurrentSelected && canEdit && !resolvePreview && (
                        <div className="flex gap-1 mt-1.5">
                            <Button variant="ghost" size="sm"
                                onClick={() => { setPlanDraft(plan?.content || ''); setEditMode(true); }}
                                data-testid="work-item-plan-edit-btn">
                                ✏️ Edit
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* AI-resolved preview — show before accepting */}
            {resolvePreview !== null && (
                <div className="space-y-2" data-testid="work-item-resolve-preview">
                    <div className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase">
                        ✅ AI resolved — new version preview
                    </div>
                    <div className="text-xs whitespace-pre-wrap font-mono bg-green-50 dark:bg-green-900/20 rounded p-3 border border-green-300 dark:border-green-700 max-h-64 overflow-y-auto">
                        {resolvePreview}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="primary" size="sm" onClick={handleAcceptResolve} disabled={accepting} loading={accepting} data-testid="work-item-resolve-accept-btn">
                            ✅ Accept new version
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setResolvePreview(null)} data-testid="work-item-resolve-reject-btn">
                            ✕ Discard
                        </Button>
                    </div>
                </div>
            )}

            {/* Comments / feedback section */}
            {isCurrentSelected && !editMode && !resolvePreview && (
                <div className="space-y-1.5 pt-1 border-t border-[#e0e0e0] dark:border-[#474749]" data-testid="work-item-plan-comments">
                    <label className="text-[10px] font-medium text-[#848484] dark:text-[#999] uppercase">
                        Comments / feedback
                    </label>
                    <textarea
                        className="w-full h-20 text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] resize-y"
                        placeholder="Describe what needs to change or improve in this plan…"
                        value={comments}
                        onChange={e => setComments(e.target.value)}
                        data-testid="work-item-plan-comments-input"
                    />
                    <Button
                        variant="ghost" size="sm"
                        onClick={handleResolveWithAI}
                        disabled={resolving || !comments.trim()}
                        loading={resolving}
                        data-testid="work-item-plan-resolve-btn"
                    >
                        🤖 Resolve with AI
                    </Button>
                    <div className="text-[10px] text-[#848484] italic">
                        AI will address your comments and create a new plan version.
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Internal editor sub-component ────────────────────────────────────────────

interface PlanEditorProps {
    draft: string;
    onChange: (v: string) => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}

function PlanEditor({ draft, onChange, onSave, onCancel, saving }: PlanEditorProps) {
    return (
        <div className="space-y-2" data-testid="work-item-plan-editor-section">
            <textarea
                className="w-full h-48 text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] resize-y font-mono"
                value={draft}
                onChange={e => onChange(e.target.value)}
                placeholder="Write your plan here…"
                data-testid="work-item-plan-editor"
            />
            <div className="flex gap-1">
                <Button variant="primary" size="sm" onClick={onSave} disabled={saving} loading={saving}>
                    Save
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
