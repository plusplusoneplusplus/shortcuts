/**
 * MemoryV2FactsTab — search/browse/edit facts in the v2 memory store.
 *
 * Layout:
 *   [Search input]  [+ Add fact]
 *   ─────────────────────────────
 *   Fact card × N  (content, tags, importance/confidence chips, provenance, actions)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Spinner } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { memoryV2Api, type MemoryFact, type MemoryFactStatus } from './memoryV2Api';

// ── Local types ───────────────────────────────────────────────────────────────

interface FactCardProps {
    fact: MemoryFact;
    onEdit: (fact: MemoryFact) => void;
    onDelete: (id: string) => void;
    onArchive: (id: string) => void;
    onOpenProcess: (processId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function importanceColor(v: number): string {
    if (v >= 0.8) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    if (v >= 0.5) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400';
}

function importanceLabel(v: number): string {
    if (v >= 0.8) return 'high';
    if (v >= 0.5) return 'medium';
    return 'low';
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

// ── FactCard ──────────────────────────────────────────────────────────────────

function FactCard({ fact, onEdit, onDelete, onArchive, onOpenProcess }: FactCardProps) {
    const [expanded, setExpanded] = useState(false);
    const isLong = fact.content.length > 180;
    const sourceProcessId = fact.sourceProcessId;
    const displayContent = isLong && !expanded
        ? fact.content.slice(0, 180) + '…'
        : fact.content;

    return (
        <div
            className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 space-y-2 bg-white dark:bg-[#1e1e1e]"
            data-testid="fact-card"
        >
            {/* Content */}
            <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc] leading-relaxed">
                {displayContent}
                {isLong && (
                    <button
                        className="ml-1 text-xs text-[#0078d4] hover:underline"
                        onClick={() => setExpanded(e => !e)}
                    >
                        {expanded ? 'less' : 'more'}
                    </button>
                )}
            </p>

            {/* Tags */}
            {fact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {fact.tags.map(tag => (
                        <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-[#e8f4fd] dark:bg-[#0e3a5c] text-[#0078d4] font-medium"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-2 text-[11px] text-[#888] flex-wrap">
                <span className={`px-1.5 py-0.5 rounded font-medium ${importanceColor(fact.importance)}`}>
                    {importanceLabel(fact.importance)}
                </span>
                <span className="text-[#aaa]">·</span>
                <span>{fact.source}</span>
                {sourceProcessId && (
                    <>
                        <span className="text-[#aaa]">·</span>
                        <button
                            className="font-mono truncate max-w-[120px] text-[#0078d4] hover:underline"
                            title={sourceProcessId}
                            onClick={() => onOpenProcess(sourceProcessId)}
                            data-testid="fact-process-link"
                        >
                            proc:{sourceProcessId.slice(0, 8)}
                        </button>
                    </>
                )}
                <span className="text-[#aaa]">·</span>
                <span title={fact.updatedAt}>{relativeTime(fact.updatedAt)}</span>
                {fact.recalledCount > 0 && (
                    <>
                        <span className="text-[#aaa]">·</span>
                        <span>recalled {fact.recalledCount}×</span>
                    </>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 pt-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(fact)}
                    data-testid="fact-edit-btn"
                >
                    Edit
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onArchive(fact.id)}
                    data-testid="fact-archive-btn"
                >
                    Archive
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => onDelete(fact.id)}
                    data-testid="fact-delete-btn"
                >
                    Delete
                </Button>
            </div>
        </div>
    );
}

// ── EditModal ─────────────────────────────────────────────────────────────────

interface EditModalProps {
    wsId: string;
    fact: MemoryFact;
    onClose: () => void;
    onSaved: (fact: MemoryFact) => void;
}

function EditModal({ wsId, fact, onClose, onSaved }: EditModalProps) {
    const [content, setContent] = useState(fact.content);
    const [tags, setTags] = useState(fact.tags.join(', '));
    const [importance, setImportance] = useState(fact.importance);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const updated = await memoryV2Api.updateFact(wsId, fact.id, {
                content,
                tags: tags.split(',').map(t => t.trim()).filter(Boolean),
                importance,
            });
            onSaved(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            data-testid="edit-modal-overlay"
        >
            <div className="bg-white dark:bg-[#252526] rounded shadow-xl p-5 w-[480px] max-w-full space-y-3">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Edit Fact</h3>

                <textarea
                    className="w-full h-28 px-3 py-2 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-none"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    data-testid="edit-content"
                />

                <div className="space-y-1">
                    <label className="block text-xs text-[#888]">Tags (comma-separated)</label>
                    <input
                        type="text"
                        className="w-full h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                        value={tags}
                        onChange={e => setTags(e.target.value)}
                        data-testid="edit-tags"
                    />
                </div>

                <div className="space-y-1">
                    <label className="block text-xs text-[#888]">Importance: {importance.toFixed(2)}</label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={importance}
                        onChange={e => setImportance(parseFloat(e.target.value))}
                        className="w-full"
                        data-testid="edit-importance"
                    />
                </div>

                {error && <p className="text-xs text-red-500">{error}</p>}

                <div className="flex items-center gap-2 pt-1">
                    <Button onClick={handleSave} disabled={saving || !content.trim()} data-testid="edit-save-btn">
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                </div>
            </div>
        </div>
    );
}

// ── AddFactForm ───────────────────────────────────────────────────────────────

interface AddFactFormProps {
    wsId: string;
    onAdded: (fact: MemoryFact) => void;
    onCancel: () => void;
}

function AddFactForm({ wsId, onAdded, onCancel }: AddFactFormProps) {
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { textareaRef.current?.focus(); }, []);

    const handleAdd = async () => {
        setSaving(true);
        setError(null);
        try {
            const fact = await memoryV2Api.createFact(wsId, content, {
                tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            });
            onAdded(fact);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#0078d4] rounded p-3 space-y-2 bg-[#f0f7ff] dark:bg-[#0c2a3e]" data-testid="add-fact-form">
            <textarea
                ref={textareaRef}
                className="w-full h-20 px-3 py-2 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-none"
                placeholder="Type a fact to remember…"
                value={content}
                onChange={e => setContent(e.target.value)}
                data-testid="add-fact-content"
            />
            <input
                type="text"
                className="w-full h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                placeholder="Tags (optional, comma-separated)"
                value={tags}
                onChange={e => setTags(e.target.value)}
                data-testid="add-fact-tags"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex items-center gap-2">
                <Button onClick={handleAdd} disabled={saving || !content.trim()} data-testid="add-fact-submit">
                    {saving ? 'Saving…' : 'Add Fact'}
                </Button>
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            </div>
        </div>
    );
}

// ── MemoryV2FactsTab ──────────────────────────────────────────────────────────

interface MemoryV2FactsTabProps {
    wsId: string;
}

export function MemoryV2FactsTab({ wsId }: MemoryV2FactsTabProps) {
    const { dispatch } = useApp();
    const [facts, setFacts] = useState<MemoryFact[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQ, setSearchQ] = useState('');
    const [statusFilter, setStatusFilter] = useState<MemoryFactStatus | ''>('active');
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingFact, setEditingFact] = useState<MemoryFact | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadFacts = useCallback(async (q?: string, status?: MemoryFactStatus | '') => {
        setLoading(true);
        setError(null);
        try {
            const loaded = await memoryV2Api.listFacts(wsId, {
                q: q?.trim() || undefined,
                status: status || undefined,
                limit: 100,
            });
            setFacts(loaded);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [wsId]);

    useEffect(() => { loadFacts(searchQ, statusFilter); }, [wsId]);

    // Debounced search
    const handleSearch = (q: string) => {
        setSearchQ(q);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => loadFacts(q, statusFilter), 350);
    };

    const handleStatusFilter = (status: MemoryFactStatus | '') => {
        setStatusFilter(status);
        loadFacts(searchQ, status);
    };

    const handleFactAdded = (fact: MemoryFact) => {
        setFacts(prev => [fact, ...prev]);
        setShowAddForm(false);
    };

    const handleFactSaved = (updated: MemoryFact) => {
        setFacts(prev => prev.map(f => f.id === updated.id ? updated : f));
        setEditingFact(null);
    };

    const handleDelete = async (id: string) => {
        try {
            await memoryV2Api.deleteFact(wsId, id);
            setFacts(prev => prev.filter(f => f.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setConfirmDeleteId(null);
        }
    };

    const handleArchive = async (id: string) => {
        try {
            const updated = await memoryV2Api.updateFact(wsId, id, { status: 'archived' });
            setFacts(prev => prev.map(f => f.id === id ? updated : f));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleOpenProcess = (processId: string) => {
        dispatch({ type: 'SELECT_PROCESS', id: processId });
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
    };

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 p-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                <input
                    type="text"
                    className="flex-1 h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    placeholder="Search facts…"
                    value={searchQ}
                    onChange={e => handleSearch(e.target.value)}
                    data-testid="facts-search"
                />
                <select
                    className="h-8 px-2 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none"
                    value={statusFilter}
                    onChange={e => handleStatusFilter(e.target.value as MemoryFactStatus | '')}
                    data-testid="facts-status-filter"
                >
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="rejected">Rejected</option>
                </select>
                <Button
                    size="sm"
                    onClick={() => setShowAddForm(true)}
                    disabled={showAddForm}
                    data-testid="add-fact-btn"
                >
                    + Add
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadFacts(searchQ, statusFilter)}
                    title="Refresh"
                    data-testid="facts-refresh-btn"
                >
                    ↻
                </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {showAddForm && (
                    <AddFactForm
                        wsId={wsId}
                        onAdded={handleFactAdded}
                        onCancel={() => setShowAddForm(false)}
                    />
                )}

                {loading && (
                    <div className="flex justify-center py-8">
                        <Spinner />
                    </div>
                )}

                {!loading && error && (
                    <p className="text-sm text-red-500" data-testid="facts-error">{error}</p>
                )}

                {!loading && !error && facts.length === 0 && (
                    <div className="text-center py-12 text-[#888]" data-testid="facts-empty">
                        <p className="text-sm">No facts found.</p>
                        {!showAddForm && (
                            <p className="text-xs mt-1">
                                Click <strong>+ Add</strong> to create your first fact.
                            </p>
                        )}
                    </div>
                )}

                {!loading && facts.map(fact => (
                    confirmDeleteId === fact.id ? (
                        <div
                            key={fact.id}
                            className="border border-red-300 rounded p-3 bg-red-50 dark:bg-red-900/20 space-y-2"
                        >
                            <p className="text-sm text-red-700 dark:text-red-300">
                                Delete this fact permanently?
                            </p>
                            <p className="text-xs text-[#888] truncate">{fact.content.slice(0, 80)}</p>
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                    onClick={() => handleDelete(fact.id)}
                                    data-testid="confirm-delete-btn"
                                >
                                    Delete
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDeleteId(null)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <FactCard
                            key={fact.id}
                            fact={fact}
                            onEdit={setEditingFact}
                            onDelete={(id) => setConfirmDeleteId(id)}
                            onArchive={handleArchive}
                            onOpenProcess={handleOpenProcess}
                        />
                    )
                ))}
            </div>

            {/* Edit modal */}
            {editingFact && (
                <EditModal
                    wsId={wsId}
                    fact={editingFact}
                    onClose={() => setEditingFact(null)}
                    onSaved={handleFactSaved}
                />
            )}
        </div>
    );
}
