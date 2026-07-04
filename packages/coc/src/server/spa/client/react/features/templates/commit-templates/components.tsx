/**
 * Presentational commit-template components shared by RepoTemplatesTab and TemplatesTab:
 * TemplateListItem, TemplateDetailView, CreateTemplateForm, and ReplicateDialog.
 * Behavior (validation, payloads, blur-based commit validation) is intentionally shared so
 * both surfaces stay in sync.
 */

import { useState } from 'react';
import type { Template, TemplateDetail } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../../api/cocClient';
import { Button, cn, Dialog, Spinner } from '../../../ui';
import { fetchApi } from '../../../hooks/useApi';
import { formatRelativeTime } from '../../../utils/format';
import { ContextMenu } from './ContextMenu';
import {
    enc,
    statusColor,
    validateTemplateName,
    parseTemplateHints,
    getTemplateErrorMessage,
} from './helpers';

// ── TemplateListItem ──

export interface TemplateListItemProps {
    template: Template;
    isSelected: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onReplicate: () => void;
    onDelete: () => void;
}

export function TemplateListItem({ template, isSelected, onSelect, onEdit, onReplicate, onDelete }: TemplateListItemProps) {
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
                if (e.shiftKey) return;
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

export interface TemplateDetailViewProps {
    template: TemplateDetail;
    loading: boolean;
    onEdit: () => void;
    onReplicate: () => void;
    onDelete: () => void;
}

export function TemplateDetailView({ template, loading, onEdit, onReplicate, onDelete }: TemplateDetailViewProps) {
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

export interface CreateTemplateFormProps {
    workspaceId: string;
    editingTemplate?: Template;
    onClose: () => void;
    onSaved: () => void;
}

export function CreateTemplateForm({ workspaceId, editingTemplate, onClose, onSaved }: CreateTemplateFormProps) {
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
        setNameError(validateTemplateName(v));
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
        const nameErr = isEdit ? null : validateTemplateName(name);
        if (nameErr) { setNameError(nameErr); return; }
        if (!isEdit && !commitValid) { setError('Please validate the commit hash first'); return; }

        setSubmitting(true);
        setError(null);
        try {
            if (isEdit) {
                await getSpaCocClient().templates.update(workspaceId, editingTemplate!.name, {
                    description,
                    hints: parseTemplateHints(hintsText),
                });
            } else {
                await getSpaCocClient().templates.create(workspaceId, {
                    name,
                    kind,
                    commitHash: commitHash.trim(),
                    description,
                    hints: parseTemplateHints(hintsText),
                });
            }
            onSaved();
        } catch (error) {
            setError(getTemplateErrorMessage(error));
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

export interface ReplicateDialogProps {
    workspaceId: string;
    template: Template;
    onClose: () => void;
}

export function ReplicateDialog({ workspaceId, template, onClose }: ReplicateDialogProps) {
    const [instruction, setInstruction] = useState('');
    const [model, setModel] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!instruction.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            await getSpaCocClient().templates.replicate(workspaceId, template.name, {
                instruction: instruction.trim(),
                model: model || undefined,
            });
            onClose();
        } catch (error) {
            setError(getTemplateErrorMessage(error));
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
