/**
 * MemoryV2ReviewTab — review queue for low-confidence / sensitive auto-extracted facts.
 *
 * Each item requires an explicit Approve, Edit & Approve, or Reject action.
 * Uses amber/warning styling to signal that these facts have not yet been validated.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, Spinner } from '../../ui';
import { memoryV2Api, type MemoryFact } from './memoryV2Api';

// ── ReviewItem ────────────────────────────────────────────────────────────────

interface ReviewItemProps {
    wsId: string;
    fact: MemoryFact;
    onApproved: (fact: MemoryFact) => void;
    onRejected: (id: string) => void;
}

function ReviewItem({ wsId, fact, onApproved, onRejected }: ReviewItemProps) {
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState(fact.content);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleApprove = async (editedContent?: string) => {
        setBusy(true);
        setError(null);
        try {
            const updated = await memoryV2Api.approveReview(wsId, fact.id, editedContent);
            onApproved(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
            setEditing(false);
        }
    };

    const handleReject = async () => {
        setBusy(true);
        setError(null);
        try {
            await memoryV2Api.rejectReview(wsId, fact.id);
            onRejected(fact.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="border border-amber-300 dark:border-amber-700 rounded p-3 space-y-2 bg-amber-50 dark:bg-amber-900/20"
            data-testid="review-item"
        >
            {/* Content */}
            {editing ? (
                <textarea
                    className="w-full h-20 px-3 py-2 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-none"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    data-testid="review-edit-content"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                />
            ) : (
                <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc] leading-relaxed">
                    {fact.content}
                </p>
            )}

            {/* Tags */}
            {fact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {fact.tags.map(tag => (
                        <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* Meta */}
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                confidence: {(fact.confidence * 100).toFixed(0)}% · source: {fact.source}
                {fact.sourceProcessId && ` · proc:${fact.sourceProcessId.slice(0, 8)}`}
            </p>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
                {editing ? (
                    <>
                        <Button
                            size="sm"
                            disabled={busy || !editContent.trim()}
                            onClick={() => handleApprove(editContent)}
                            data-testid="review-edit-approve-btn"
                        >
                            {busy ? 'Saving…' : 'Approve edited'}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditing(false); setEditContent(fact.content); }}
                        >
                            Cancel
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => handleApprove()}
                            data-testid="review-approve-btn"
                        >
                            {busy ? '…' : 'Approve'}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setEditing(true)}
                            data-testid="review-edit-btn"
                        >
                            Edit
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            onClick={handleReject}
                            data-testid="review-reject-btn"
                        >
                            Reject
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

// ── MemoryV2ReviewTab ─────────────────────────────────────────────────────────

interface MemoryV2ReviewTabProps {
    wsId: string;
}

export function MemoryV2ReviewTab({ wsId }: MemoryV2ReviewTabProps) {
    const [items, setItems] = useState<MemoryFact[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadReview = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setItems(await memoryV2Api.listReview(wsId));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [wsId]);

    useEffect(() => { loadReview(); }, [loadReview]);

    const handleApproved = (updated: MemoryFact) => {
        setItems(prev => prev.filter(i => i.id !== updated.id));
    };

    const handleRejected = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    {loading ? 'Loading…' : `${items.length} item${items.length !== 1 ? 's' : ''} need review`}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadReview}
                    title="Refresh"
                    data-testid="review-refresh-btn"
                >
                    ↻
                </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading && (
                    <div className="flex justify-center py-8"><Spinner /></div>
                )}

                {!loading && error && (
                    <p className="text-sm text-red-500" data-testid="review-error">{error}</p>
                )}

                {!loading && !error && items.length === 0 && (
                    <div className="text-center py-12" data-testid="review-empty">
                        <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                            ✓ Review queue is empty
                        </p>
                        <p className="text-xs text-[#888] mt-1">
                            All auto-extracted facts have been reviewed.
                        </p>
                    </div>
                )}

                {!loading && items.map(fact => (
                    <ReviewItem
                        key={fact.id}
                        wsId={wsId}
                        fact={fact}
                        onApproved={handleApproved}
                        onRejected={handleRejected}
                    />
                ))}
            </div>
        </div>
    );
}
