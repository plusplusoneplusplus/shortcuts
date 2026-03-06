/**
 * RepoTemplatesTab — workspace-scoped template management with CRUD, replicate action.
 * Follows the RepoSchedulesTab split-panel pattern.
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Button, cn, Dialog, Spinner } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { formatRelativeTime } from '../utils/format';

// ── Local types ──

interface Template {
    name: string;
    kind: 'commit';
    commitHash: string;
    description?: string;
    hints?: string[];
    createdAt: string;
    updatedAt?: string;
}

interface TemplateDetail extends Template {
    changedFiles?: ChangedFile[];
}

interface ChangedFile {
    path: string;
    status: string;
    additions?: number;
    deletions?: number;
}

// ── Props ──

interface RepoTemplatesTabProps {
    workspaceId: string;
}

// ── Helpers ──

const enc = encodeURIComponent;
const CT_JSON = { 'Content-Type': 'application/json' };

function statusColor(status: string): string {
    switch (status) {
        case 'added': return 'text-green-600 dark:text-green-400';
        case 'deleted': return 'text-red-500 dark:text-red-400';
        case 'renamed': return 'text-yellow-600 dark:text-yellow-400';
        default: return 'text-[#6e6e6e] dark:text-[#888]';
    }
}

function validateName(v: string): string | null {
    if (!v) return 'Name is required';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return 'Must be kebab-case (e.g., fix-parser)';
    if (v.length > 64) return 'Max 64 characters';
    return null;
}

function parseHints(text: string): string[] {
    return text.split('\n').map(l => l.trim()).filter(Boolean);
}

// ── Context Menu ──

function ContextMenu({ x, y, items, onClose }: {
    x: number; y: number;
    items: { label: string; onClick: () => void; danger?: boolean }[];
    onClose: () => void;
}) {
    useEffect(() => {
        const handler = () => onClose();
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            className="fixed bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1 z-[10003]"
            style={{ left: x, top: y }}
            data-testid="template-context-menu"
        >
            {items.map(item => (
                <button
                    key={item.label}
                    className={cn(
                        "block w-full text-left px-4 py-1.5 text-sm hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]",
                        item.danger ? "text-red-500" : "text-[#1e1e1e] dark:text-[#cccccc]"
                    )}
                    onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
                >
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
}

// ── TemplateListItem ──

interface TemplateListItemProps {
    template: Template;
    isSelected: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onReplicate: () => void;
    onDelete: () => void;
}

function TemplateListItem({ template, isSelected, onSelect, onEdit, onReplicate, onDelete }: TemplateListItemProps) {
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

    return (
        <li
            className={cn(
                "px-4 py-2.5 cursor-pointer border-b border-[#f0f0f0] dark:border-[#2a2a2a] text-sm",
                "hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a]",
                isSelected && "bg-[#e8f0fe] dark:bg-[#1a3a5c] border-l-2 border-l-[#0078d4]"
            )}
            onClick={onSelect}
            onContextMenu={(e) => {
                e.preventDefault();
                setMenuPos({ x: e.clientX, y: e.clientY });
                setShowContextMenu(true);
            }}
            data-testid={`template-item-${template.name}`}
        >
            <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                {template.name}
            </div>
            <div className="text-xs text-[#6e6e6e] dark:text-[#888] mt-0.5 truncate">
                {template.kind} · {template.commitHash.slice(0, 8)}
            </div>

            {showContextMenu && (
                <ContextMenu
                    x={menuPos.x}
                    y={menuPos.y}
                    onClose={() => setShowContextMenu(false)}
                    items={[
                        { label: 'Replicate…', onClick: onReplicate },
                        { label: 'Edit', onClick: onEdit },
                        { label: 'Delete', onClick: onDelete, danger: true },
                    ]}
                />
            )}
        </li>
    );
}

// ── TemplateDetailView ──

interface TemplateDetailViewProps {
    template: TemplateDetail;
    loading: boolean;
    onEdit: () => void;
    onReplicate: () => void;
    onDelete: () => void;
}

function TemplateDetailView({ template, loading, onEdit, onReplicate, onDelete }: TemplateDetailViewProps) {
    if (loading) return <div className="flex items-center justify-center h-full"><Spinner /></div>;

    return (
        <div className="p-6" data-testid="template-detail">
            {/* Header with action buttons */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#e0e0e0]">
                        {template.name}
                    </h2>
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4]">
                        {template.kind}
                    </span>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={onReplicate} data-testid="template-replicate-btn">
                        Replicate…
                    </Button>
                    <Button size="sm" onClick={onEdit} data-testid="template-edit-btn">Edit</Button>
                    <Button size="sm" variant="danger" onClick={onDelete} data-testid="template-delete-btn">Delete</Button>
                </div>
            </div>

            {/* Commit hash */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                    Commit
                </label>
                <div className="mt-1 flex items-center gap-2">
                    <code className="text-sm font-mono bg-[#f5f5f5] dark:bg-[#1e1e1e] px-2 py-1 rounded">
                        {template.commitHash}
                    </code>
                    <button
                        className="text-xs text-[#0078d4] hover:underline"
                        onClick={() => navigator.clipboard.writeText(template.commitHash)}
                        data-testid="template-copy-hash"
                    >
                        Copy
                    </button>
                </div>
            </div>

            {/* Description */}
            {template.description && (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                        Description
                    </label>
                    <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap">
                        {template.description}
                    </p>
                </div>
            )}

            {/* Hints */}
            {template.hints && template.hints.length > 0 && (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                        Hints
                    </label>
                    <ul className="mt-1 list-disc list-inside text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                        {template.hints.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                </div>
            )}

            {/* Changed files */}
            {template.changedFiles && template.changedFiles.length > 0 && (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                        Changed Files ({template.changedFiles.length})
                    </label>
                    <div className="mt-1 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-hidden">
                        {template.changedFiles.map((f, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "flex items-center justify-between px-3 py-1.5 text-sm font-mono",
                                    i > 0 && "border-t border-[#f0f0f0] dark:border-[#2a2a2a]"
                                )}
                            >
                                <span className="text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                    {f.path}
                                </span>
                                <span className={cn("text-xs ml-2 flex-shrink-0", statusColor(f.status))}>
                                    {f.status}
                                    {f.additions != null && (
                                        <span className="text-green-600 dark:text-green-400 ml-1">+{f.additions}</span>
                                    )}
                                    {f.deletions != null && (
                                        <span className="text-red-500 ml-1">-{f.deletions}</span>
                                    )}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-[#999] dark:text-[#666] mt-6">
                Created {formatRelativeTime(template.createdAt)}
                {template.updatedAt && ` · Updated ${formatRelativeTime(template.updatedAt)}`}
            </div>
        </div>
    );
}

// ── CreateTemplateForm ──

interface CreateTemplateFormProps {
    workspaceId: string;
    editingTemplate?: Template;
    onClose: () => void;
    onSaved: () => void;
}

function CreateTemplateForm({ workspaceId, editingTemplate, onClose, onSaved }: CreateTemplateFormProps) {
    const isEdit = !!editingTemplate;

    const [name, setName] = useState(editingTemplate?.name || '');
    const [kind] = useState<'commit'>(editingTemplate?.kind || 'commit');
    const [commitHash, setCommitHash] = useState(editingTemplate?.commitHash || '');
    const [description, setDescription] = useState(editingTemplate?.description || '');
    const [hintsText, setHintsText] = useState((editingTemplate?.hints || []).join('\n'));

    const [commitValid, setCommitValid] = useState<boolean | null>(isEdit ? true : null);
    const [commitInfo, setCommitInfo] = useState<string | null>(null);
    const [nameError, setNameError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleNameChange = (v: string) => {
        setName(v);
        setNameError(validateName(v));
    };

    const handleCommitBlur = async () => {
        if (!commitHash.trim()) { setCommitValid(null); setCommitInfo(null); return; }
        try {
            const data = await fetchApi(
                `/workspaces/${enc(workspaceId)}/git/commits/${enc(commitHash.trim())}`
            );
            setCommitValid(true);
            setCommitInfo(data.subject || data.message?.split('\n')[0] || 'Valid commit');
        } catch {
            setCommitValid(false);
            setCommitInfo('Commit not found or not reachable');
        }
    };

    const handleSubmit = async () => {
        const nameErr = isEdit ? null : validateName(name);
        if (nameErr) { setNameError(nameErr); return; }
        if (!isEdit && !commitValid) { setError('Please validate the commit hash first'); return; }

        setSubmitting(true);
        setError(null);
        try {
            if (isEdit) {
                const res = await fetch(
                    getApiBase() + `/workspaces/${enc(workspaceId)}/templates/${enc(editingTemplate!.name)}`,
                    { method: 'PATCH', headers: CT_JSON, body: JSON.stringify({ description, hints: parseHints(hintsText) }) }
                );
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || `Failed: ${res.status}`);
                }
            } else {
                const res = await fetch(
                    getApiBase() + `/workspaces/${enc(workspaceId)}/templates`,
                    { method: 'POST', headers: CT_JSON, body: JSON.stringify({ name, kind, commitHash: commitHash.trim(), description, hints: parseHints(hintsText) }) }
                );
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || `Failed: ${res.status}`);
                }
            }
            onSaved();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-6" data-testid="template-form">
            <div className="flex items-center gap-3 mb-6">
                <button
                    className="text-sm text-[#0078d4] hover:underline"
                    onClick={onClose}
                    data-testid="template-form-back"
                >
                    ← Back
                </button>
                <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#e0e0e0]">
                    {isEdit ? 'Edit Template' : 'Create Template'}
                </h2>
            </div>

            {/* Name */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">
                    Name <span className="text-red-500">*</span>
                </label>
                {isEdit ? (
                    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc] font-mono">{name}</div>
                ) : (
                    <>
                        <input
                            className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                            value={name}
                            onChange={e => handleNameChange(e.target.value)}
                            placeholder="e.g., add-config-field"
                            data-testid="template-name-input"
                        />
                        {nameError && <div className="text-xs text-red-500 mt-1">{nameError}</div>}
                    </>
                )}
            </div>

            {/* Kind */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">Kind</label>
                {isEdit ? (
                    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">{kind}</div>
                ) : (
                    <select
                        className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                        value={kind}
                        disabled
                        data-testid="template-kind-select"
                    >
                        <option value="commit">commit</option>
                    </select>
                )}
            </div>

            {/* Commit Hash */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">
                    Commit Hash <span className="text-red-500">*</span>
                </label>
                {isEdit ? (
                    <code className="text-sm font-mono text-[#1e1e1e] dark:text-[#cccccc]">{commitHash}</code>
                ) : (
                    <>
                        <input
                            className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                            value={commitHash}
                            onChange={e => { setCommitHash(e.target.value); setCommitValid(null); setCommitInfo(null); }}
                            onBlur={handleCommitBlur}
                            placeholder="e.g., abc123f"
                            data-testid="template-commit-input"
                        />
                        {commitValid === true && commitInfo && (
                            <div className="text-xs text-green-600 dark:text-green-400 mt-1">✓ {commitInfo}</div>
                        )}
                        {commitValid === false && commitInfo && (
                            <div className="text-xs text-red-500 mt-1">✗ {commitInfo}</div>
                        )}
                    </>
                )}
            </div>

            {/* Description */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">Description</label>
                <textarea
                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-y"
                    rows={3}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Optional description of the template"
                    data-testid="template-description-input"
                />
            </div>

            {/* Hints */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">Hints (one per line)</label>
                <textarea
                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-y"
                    rows={3}
                    value={hintsText}
                    onChange={e => setHintsText(e.target.value)}
                    placeholder="Optional hints for replication, one per line"
                    data-testid="template-hints-input"
                />
            </div>

            {/* Error */}
            {error && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5 mb-4" data-testid="template-form-error">
                    {error}
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
                <Button onClick={onClose} data-testid="template-form-cancel">Cancel</Button>
                <Button
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={submitting}
                    data-testid="template-form-submit"
                >
                    {submitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
                </Button>
            </div>
        </div>
    );
}

// ── ReplicateDialog ──

interface ReplicateDialogProps {
    workspaceId: string;
    template: Template;
    onClose: () => void;
}

function ReplicateDialog({ workspaceId, template, onClose }: ReplicateDialogProps) {
    const [instruction, setInstruction] = useState('');
    const [model, setModel] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!instruction.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(
                getApiBase() + `/workspaces/${enc(workspaceId)}/templates/${enc(template.name)}/replicate`,
                {
                    method: 'POST',
                    headers: CT_JSON,
                    body: JSON.stringify({
                        instruction: instruction.trim(),
                        model: model || undefined
                    })
                }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed: ${res.status}`);
            }
            onClose();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open
            onClose={onClose}
            title={`Replicate: ${template.name}`}
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={submitting || !instruction.trim()}
                        data-testid="replicate-submit-btn"
                    >
                        {submitting ? 'Replicating…' : 'Replicate'}
                    </Button>
                </div>
            }
        >
            {/* Read-only template info */}
            <div className="mb-4 text-sm">
                <div className="text-[#6e6e6e] dark:text-[#888]">Template</div>
                <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{template.name}</div>
                <code className="text-xs font-mono text-[#6e6e6e]">{template.commitHash.slice(0, 12)}</code>
            </div>

            {/* Instruction textarea */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">
                    What should change? <span className="text-red-500">*</span>
                </label>
                <textarea
                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-y"
                    rows={4}
                    value={instruction}
                    onChange={e => setInstruction(e.target.value)}
                    placeholder="Describe what should be different in the replicated commit…"
                    autoFocus
                    data-testid="replicate-instruction-input"
                />
            </div>

            {/* Optional model override */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">Model (optional)</label>
                <input
                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="e.g., claude-sonnet-4-20250514 (leave blank for default)"
                    data-testid="replicate-model-input"
                />
            </div>

            {/* Error display */}
            {error && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5" data-testid="replicate-error">
                    {error}
                </div>
            )}
        </Dialog>
    );
}

// ── Main Component ──

export function RepoTemplatesTab({ workspaceId }: RepoTemplatesTabProps) {
    // List state
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedName, setSelectedName] = useState<string | null>(null);

    // Detail state
    const [detail, setDetail] = useState<TemplateDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Form state
    const [showCreate, setShowCreate] = useState(false);
    const [editingName, setEditingName] = useState<string | null>(null);

    // Replicate dialog
    const [replicateTarget, setReplicateTarget] = useState<Template | null>(null);

    // ── API Calls ──

    const fetchTemplates = useCallback(async () => {
        try {
            const data = await fetchApi(
                `/workspaces/${enc(workspaceId)}/templates`
            );
            setTemplates(data?.templates || []);
        } catch {
            setTemplates([]);
        }
        setLoading(false);
    }, [workspaceId]);

    // Fetch detail on selection
    useEffect(() => {
        if (!selectedName) { setDetail(null); return; }
        let cancelled = false;
        setDetailLoading(true);
        fetchApi(
            `/workspaces/${enc(workspaceId)}/templates/${enc(selectedName)}`
        ).then(data => {
            if (!cancelled) { setDetail(data); setDetailLoading(false); }
        }).catch(() => {
            if (!cancelled) { setDetail(null); setDetailLoading(false); }
        });
        return () => { cancelled = true; };
    }, [workspaceId, selectedName]);

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete template "${name}"?`)) return;
        await fetch(
            getApiBase() + `/workspaces/${enc(workspaceId)}/templates/${enc(name)}`,
            { method: 'DELETE' }
        );
        if (selectedName === name) setSelectedName(null);
        fetchTemplates();
    };

    // ── WebSocket Events ──

    useEffect(() => {
        const wsHandler = () => fetchTemplates();
        window.addEventListener('templates-changed', wsHandler);
        return () => window.removeEventListener('templates-changed', wsHandler);
    }, [workspaceId, fetchTemplates]);

    // ── Mount & Refresh ──

    useEffect(() => {
        setLoading(true);
        fetchTemplates();
    }, [workspaceId, fetchTemplates]);

    // Reset selection when workspace changes
    useEffect(() => {
        setSelectedName(null);
        setShowCreate(false);
        setEditingName(null);
    }, [workspaceId]);

    // ── Render ──

    return (
        <div className="flex h-full overflow-hidden" data-testid="templates-tab">
            {/* ── LEFT PANEL ── */}
            <div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#2d2d2d] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#2d2d2d]">
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Templates
                        {templates.length > 0 && (
                            <span className="ml-1.5 text-xs text-[#6e6e6e] dark:text-[#888]" data-testid="templates-count">
                                ({templates.length})
                            </span>
                        )}
                    </span>
                    <Button size="sm" onClick={() => { setShowCreate(true); setEditingName(null); }} data-testid="templates-new-btn">
                        + New
                    </Button>
                </div>

                {/* Loading state */}
                {loading && (
                    <div className="flex-1 flex items-center justify-center">
                        <Spinner />
                    </div>
                )}

                {/* Empty state */}
                {!loading && templates.length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-center px-4" data-testid="templates-empty">
                        <div>
                            <div className="text-2xl mb-2">📋</div>
                            <div className="text-sm text-[#6e6e6e] dark:text-[#888]">
                                No templates yet
                            </div>
                            <div className="text-xs text-[#999] dark:text-[#666] mt-1">
                                Create a template from a commit to replicate patterns
                            </div>
                        </div>
                    </div>
                )}

                {/* Scrollable list */}
                {!loading && templates.length > 0 && (
                    <ul className="flex-1 overflow-y-auto" data-testid="templates-list">
                        {templates.map(t => (
                            <TemplateListItem
                                key={t.name}
                                template={t}
                                isSelected={selectedName === t.name}
                                onSelect={() => {
                                    setSelectedName(t.name);
                                    setShowCreate(false);
                                    setEditingName(null);
                                }}
                                onEdit={() => { setEditingName(t.name); setShowCreate(false); }}
                                onReplicate={() => setReplicateTarget(t)}
                                onDelete={() => handleDelete(t.name)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            {/* ── RIGHT PANEL ── */}
            <div className="flex-1 min-w-0 overflow-y-auto">
                {showCreate || editingName ? (
                    <CreateTemplateForm
                        workspaceId={workspaceId}
                        editingTemplate={editingName ? templates.find(t => t.name === editingName) : undefined}
                        onClose={() => { setShowCreate(false); setEditingName(null); }}
                        onSaved={() => {
                            setShowCreate(false);
                            setEditingName(null);
                            fetchTemplates();
                        }}
                    />
                ) : selectedName && detail ? (
                    <TemplateDetailView
                        template={detail}
                        loading={detailLoading}
                        onEdit={() => setEditingName(detail.name)}
                        onReplicate={() => setReplicateTarget(detail)}
                        onDelete={() => handleDelete(detail.name)}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center text-[#6e6e6e] dark:text-[#888] text-sm" data-testid="templates-empty-detail">
                        Select a template to view details
                    </div>
                )}
            </div>

            {/* ── REPLICATE DIALOG (modal) ── */}
            {replicateTarget && (
                <ReplicateDialog
                    workspaceId={workspaceId}
                    template={replicateTarget}
                    onClose={() => setReplicateTarget(null)}
                />
            )}
        </div>
    );
}
