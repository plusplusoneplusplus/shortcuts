/**
 * WorkItemParentPicker — dialog for selecting/changing a work item's parent.
 * Lists valid parent candidates filtered by the child item's type constraints.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui';
import { getSpaCocClient } from '../../api/cocClient';
import { ALLOWED_PARENT_TYPES } from '@plusplusoneplusplus/coc-client';
import { TYPE_LABELS } from './WorkItemHierarchyNode';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';

const TYPE_PREFIX: Record<WorkItemTypeLabel, string> = {
    epic: 'E',
    feature: 'F',
    pbi: 'PBI',
    'work-item': 'WI',
    bug: 'BUG',
    goal: 'GOAL',
};

interface ParentCandidate {
    id: string;
    title: string;
    type: WorkItemTypeLabel;
    workItemNumber?: number;
    status: string;
}

export interface WorkItemParentPickerProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    itemId: string;
    itemType: WorkItemTypeLabel;
    currentParentId?: string;
    /** Called with null to unlink, or with newParentId to re-parent. */
    onParentChanged: (newParentId: string | null) => void;
    /**
     * When true, the dialog only selects a new parent without making API calls,
     * and does not offer an unlink action. The caller is responsible for persisting
     * the chosen parent.
     */
    onlyPick?: boolean;
}

export function WorkItemParentPicker({
    open,
    onClose,
    workspaceId,
    itemId,
    itemType,
    currentParentId,
    onParentChanged,
    onlyPick = false,
}: WorkItemParentPickerProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [candidates, setCandidates] = useState<ParentCandidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(currentParentId ?? null);

    const validParentTypes = ALLOWED_PARENT_TYPES[itemType] ?? [];

    const fetchCandidates = useCallback(async () => {
        if (validParentTypes.length === 0) return;
        setLoading(true);
        setError(null);
        try {
            const results: ParentCandidate[] = [];
            for (const parentType of validParentTypes) {
                const resp = await getSpaCocClient().workItems.list(workspaceId, {
                    type: parentType,
                    q: searchQuery || undefined,
                    limit: 50,
                });
                for (const wi of resp.items) {
                    if (wi.id === itemId) continue; // exclude self
                    results.push({
                        id: wi.id,
                        title: wi.title,
                        type: (wi.type ?? 'work-item') as WorkItemTypeLabel,
                        workItemNumber: wi.workItemNumber,
                        status: wi.status,
                    });
                }
            }
            setCandidates(results);
        } catch (err: any) {
            setError(err.message ?? 'Failed to load candidates');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, itemId, validParentTypes, searchQuery]);

    useEffect(() => {
        if (open) {
            setSelectedId(currentParentId ?? null);
            setSearchQuery('');
            setError(null);
            fetchCandidates();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => fetchCandidates(), 300);
        return () => clearTimeout(timer);
    }, [searchQuery, fetchCandidates, open]);

    const handleConfirm = async () => {
        if (onlyPick) {
            onParentChanged(selectedId);
            onClose();
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await getSpaCocClient().workItems.update(workspaceId, itemId, { parentId: selectedId ?? undefined });
            onParentChanged(selectedId);
            onClose();
        } catch (err: any) {
            setError(err.message ?? 'Failed to update parent');
        } finally {
            setSaving(false);
        }
    };

    const handleUnlink = async () => {
        setSaving(true);
        setError(null);
        try {
            await getSpaCocClient().workItems.update(workspaceId, itemId, { parentId: null });
            onParentChanged(null);
            onClose();
        } catch (err: any) {
            setError(err.message ?? 'Failed to unlink parent');
        } finally {
            setSaving(false);
        }
    };

    if (validParentTypes.length === 0) {
        return (
            <Dialog open={open} onClose={onClose} title="Parent">
                <p className="text-sm text-[#848484]">
                    {TYPE_LABELS[itemType] ?? itemType} items cannot have a parent.
                </p>
                <div className="mt-3 flex justify-end">
                    <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                </div>
            </Dialog>
        );
    }

    const filtered = searchQuery
        ? candidates.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
        : candidates;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Change Parent"
            footer={
                <>
                    {currentParentId && !onlyPick && (
                        <Button variant="ghost" size="sm" onClick={handleUnlink} disabled={saving} className="mr-auto text-red-500">
                            Unlink Parent
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleConfirm}
                        disabled={saving || selectedId === currentParentId}
                        loading={saving}
                    >
                        Confirm
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <p className="text-xs text-[#848484]">
                    Valid parent types: {validParentTypes.map(t => TYPE_LABELS[t]).join(', ')}
                </p>
                <input
                    type="text"
                    className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                    placeholder="Search…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    data-testid="parent-picker-search"
                />
                {error && (
                    <p className="text-xs text-red-500" data-testid="parent-picker-error">{error}</p>
                )}
                {loading ? (
                    <p className="text-xs text-[#848484] py-2">Loading…</p>
                ) : filtered.length === 0 ? (
                    <p className="text-xs text-[#848484] py-2">No candidates found.</p>
                ) : (
                    <div className="max-h-60 overflow-y-auto border border-[#e0e0e0] dark:border-[#555] rounded" data-testid="parent-picker-list">
                        {filtered.map(c => {
                            const prefix = TYPE_PREFIX[c.type] ?? 'WI';
                            const label = TYPE_LABELS[c.type] ?? c.type;
                            const isSelected = c.id === selectedId;
                            return (
                                <button
                                    key={c.id}
                                    className={cn(
                                        'w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b border-[#f0f0f0] dark:border-[#333] last:border-0 transition-colors',
                                        isSelected
                                            ? 'bg-[#007acc]/10 dark:bg-[#007acc]/15'
                                            : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]',
                                    )}
                                    onClick={() => setSelectedId(c.id)}
                                    data-testid={`parent-candidate-${c.id}`}
                                >
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                                        {label}
                                    </span>
                                    {c.workItemNumber != null && (
                                        <span className="text-[10px] text-[#848484] font-mono shrink-0">
                                            {prefix}-{c.workItemNumber}
                                        </span>
                                    )}
                                    <span className="flex-1 truncate text-[#3c3c3c] dark:text-[#cccccc]" title={c.title}>
                                        {c.title}
                                    </span>
                                    {isSelected && <span className="text-[#007acc] text-xs shrink-0">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Dialog>
    );
}

// ── Local helper ─────────────────────────────────────────────────────────────
function cn(...classes: (string | boolean | undefined | null)[]): string {
    return classes.filter(Boolean).join(' ');
}
