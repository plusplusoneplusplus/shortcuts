/**
 * TemplatesTab — two-panel layout with collapsible Workflows, Templates,
 * AI Chat Templates, and Prompt & Script Templates sections.
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { Template, TemplateChangedFile, TemplateDetail } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { Button, cn, Dialog, Spinner } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useGlobalToast } from '../../contexts/ToastContext';
import { fetchApi } from '../../hooks/useApi';
import { formatRelativeTime } from '../../utils/format';
import type { RepoData, WorkflowInfo } from '../../repos/repoGrouping';
import { WorkflowDetail } from '../workflow/WorkflowDetail';
import { AddWorkflowDialog } from '../workflow/AddWorkflowDialog';
import { useSkillTemplates } from './hooks/useSkillTemplates';
import type { SkillTemplate } from './hooks/useSkillTemplates';
import { useScriptTemplates } from './hooks/useScriptTemplates';
import type { ScriptTemplate } from './hooks/useScriptTemplates';

// ── Template helpers ──

const enc = encodeURIComponent;

function statusColor(status: TemplateChangedFile['status']): string {
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

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ── ContextMenu ──

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

// ── SkillTemplateListItem ──

interface SkillTemplateListItemProps {
    template: SkillTemplate;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
}

function SkillTemplateListItem({ template, isSelected, onSelect, onDelete }: SkillTemplateListItemProps) {
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
            data-testid={`skill-template-item-${template.id}`}
        >
            <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                {template.name ?? template.id}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs px-1.5 py-0.5 rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4]">
                    {template.mode}
                </span>
                <span className="text-xs text-[#6e6e6e] dark:text-[#888] truncate">
                    {template.model || 'default'}
                </span>
            </div>

            {showContextMenu && (
                <ContextMenu
                    x={menuPos.x}
                    y={menuPos.y}
                    onClose={() => setShowContextMenu(false)}
                    items={[
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

            <div className="text-xs text-[#999] dark:text-[#666] mt-6">
                Created {formatRelativeTime(template.createdAt)}
                {template.updatedAt && ` · Updated ${formatRelativeTime(template.updatedAt)}`}
            </div>
        </div>
    );
}

// ── SkillTemplateDetailView ──

interface SkillTemplateDetailViewProps {
    template: SkillTemplate;
    onDelete: () => void;
}

function SkillTemplateDetailView({ template, onDelete }: SkillTemplateDetailViewProps) {
    const [copied, setCopied] = useState(false);

    const handleCopyId = () => {
        navigator.clipboard.writeText(template.id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
    };

    return (
        <div className="p-6" data-testid="skill-template-detail">
            <div className="flex items-start justify-between mb-6">
                <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#e0e0e0]">
                    {template.name ?? template.id}
                </h2>
                <Button size="sm" variant="danger" onClick={onDelete} data-testid="skill-template-delete-btn">
                    Delete
                </Button>
            </div>

            {/* ID */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">ID</label>
                <div className="mt-1 flex items-center gap-2">
                    <code className="text-sm text-[#1e1e1e] dark:text-[#cccccc] bg-[#f5f5f5] dark:bg-[#2a2a2a] px-1.5 py-0.5 rounded font-mono" data-testid="skill-template-id-value">
                        {template.id}
                    </code>
                    <button
                        onClick={handleCopyId}
                        className="text-xs text-[#0078d4] hover:text-[#005a9e] dark:hover:text-[#4da6ff] cursor-pointer"
                        title="Copy ID"
                        data-testid="skill-template-copy-id-btn"
                    >
                        {copied ? '✓ Copied' : '📋 Copy'}
                    </button>
                </div>
            </div>

            {/* Mode */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Mode</label>
                <div className="mt-1">
                    <span className="px-2 py-0.5 text-xs rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4]">
                        {template.mode}
                    </span>
                </div>
            </div>

            {/* Model */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Model</label>
                <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                    {template.model || 'default'}
                </p>
            </div>

            {/* Skills */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Skills</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                    {template.skills.length === 0
                        ? <span className="text-sm text-[#848484]">None</span>
                        : template.skills.map(s => (
                            <span key={s} className="px-2 py-0.5 text-xs rounded bg-[#f0f0f0] dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#cccccc]">
                                {s}
                            </span>
                          ))
                    }
                </div>
            </div>
        </div>
    );
}

// ── ScriptTemplateListItem ──

interface ScriptTemplateListItemProps {
    template: ScriptTemplate;
    isSelected: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

function ScriptTemplateListItem({ template, isSelected, onSelect, onEdit, onDelete }: ScriptTemplateListItemProps) {
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
            data-testid={`script-template-item-${template.id}`}
        >
            <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                📜 {template.name}
            </div>
            <div className="font-mono text-xs text-[#848484] truncate">{template.scriptPath}</div>
            {template.args && <div className="font-mono text-xs text-[#848484] truncate">{template.args}</div>}
            <div className="flex items-center gap-1.5 mt-0.5">
                {template.model && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999]">{template.model}</span>
                )}
                {template.pauseOnFailure && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#fff3cd] dark:bg-[#4d3800] text-[#856404] dark:text-[#ffc107]">pause on failure</span>
                )}
            </div>

            {showContextMenu && (
                <ContextMenu
                    x={menuPos.x}
                    y={menuPos.y}
                    onClose={() => setShowContextMenu(false)}
                    items={[
                        { label: 'Edit', onClick: onEdit },
                        { label: 'Delete', onClick: onDelete, danger: true },
                    ]}
                />
            )}
        </li>
    );
}

// ── ScriptTemplateDetailView ──

interface ScriptTemplateDetailViewProps {
    template: ScriptTemplate;
    workspaceId: string;
    editing: boolean;
    onEdit: () => void;
    onCancelEdit: () => void;
    onUpdate: (id: string, updates: Partial<Omit<ScriptTemplate, 'id'>>) => void;
    onDelete: () => void;
}

function ScriptTemplateDetailView({ template, workspaceId, editing, onEdit, onCancelEdit, onUpdate, onDelete }: ScriptTemplateDetailViewProps) {
    const { dispatch: queueDispatch } = useQueue();
    const { addToast } = useGlobalToast();
    const [enqueueing, setEnqueueing] = useState(false);

    const [formName, setFormName] = useState(template.name);
    const [formScriptPath, setFormScriptPath] = useState(template.scriptPath);
    const [formArgs, setFormArgs] = useState(template.args || '');
    const [formWorkingDirectory, setFormWorkingDirectory] = useState(template.workingDirectory || '');
    const [formModel, setFormModel] = useState(template.model || '');
    const [formPauseOnFailure, setFormPauseOnFailure] = useState(template.pauseOnFailure || false);

    // Reset form state when template changes
    useEffect(() => {
        setFormName(template.name);
        setFormScriptPath(template.scriptPath);
        setFormArgs(template.args || '');
        setFormWorkingDirectory(template.workingDirectory || '');
        setFormModel(template.model || '');
        setFormPauseOnFailure(template.pauseOnFailure || false);
    }, [template.id]);

    const handleSave = () => {
        const trimmedName = formName.trim();
        const trimmedScriptPath = formScriptPath.trim();
        if (!trimmedName || !trimmedScriptPath) return;
        onUpdate(template.id, {
            name: trimmedName,
            scriptPath: trimmedScriptPath,
            args: formArgs.trim() || undefined,
            workingDirectory: formWorkingDirectory.trim() || undefined,
            model: formModel.trim() || undefined,
            pauseOnFailure: formPauseOnFailure || undefined,
        });
        onCancelEdit();
    };

    const handleCancel = () => {
        setFormName(template.name);
        setFormScriptPath(template.scriptPath);
        setFormArgs(template.args || '');
        setFormWorkingDirectory(template.workingDirectory || '');
        setFormModel(template.model || '');
        setFormPauseOnFailure(template.pauseOnFailure || false);
        onCancelEdit();
    };

    const handleEnqueue = async () => {
        setEnqueueing(true);
        try {
            const fullScript = template.args ? `${template.scriptPath} ${template.args}` : template.scriptPath;
            const displayName = template.scriptPath.split(/[\\/]/).pop() || template.scriptPath;

            const payload: Record<string, unknown> = { script: fullScript };
            if (template.workingDirectory) payload.workingDirectory = template.workingDirectory;

            const config: Record<string, unknown> = {};
            if (template.model) config.model = template.model;
            if (template.pauseOnFailure) config.pauseOnFailure = true;

            await getSpaCocClient().queue.enqueue({
                type: 'run-script',
                displayName,
                payload,
                config,
                repoId: workspaceId || undefined,
            });

            const data = await getSpaCocClient().queue.list();
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
            addToast(`Enqueued "${template.name}"`, 'success');
        } catch (err) {
            addToast(getSpaCocClientErrorMessage(err, 'Failed to enqueue script'), 'error');
        } finally {
            setEnqueueing(false);
        }
    };

    const inputClass = "w-full px-3 py-1.5 text-sm rounded border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]";

    return (
        <div className="p-6" data-testid="script-template-detail">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
                {editing ? (
                    <div className="flex-1 mr-4">
                        <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Name *</label>
                        <input
                            className={cn(inputClass, "mt-1")}
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            data-testid="script-template-edit-name"
                        />
                    </div>
                ) : (
                    <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#e0e0e0]">
                        {template.name}
                    </h2>
                )}
                <div className="flex gap-2">
                    {editing ? (
                        <>
                            <Button size="sm" variant="primary" onClick={handleSave} data-testid="script-template-save-btn">
                                💾 Save
                            </Button>
                            <Button size="sm" variant="secondary" onClick={handleCancel} data-testid="script-template-cancel-btn">
                                Cancel
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button size="sm" variant="primary" onClick={handleEnqueue} disabled={enqueueing} data-testid="script-template-enqueue-btn">
                                {enqueueing ? 'Enqueuing…' : '▶ Enqueue'}
                            </Button>
                            <Button size="sm" variant="secondary" onClick={onEdit} data-testid="script-template-edit-btn">
                                ✏ Edit
                            </Button>
                            <Button size="sm" variant="danger" onClick={onDelete} data-testid="script-template-delete-btn">
                                Delete
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Script / Command */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Script / Command{editing ? ' *' : ''}</label>
                {editing ? (
                    <input
                        className={cn(inputClass, "mt-1 font-mono")}
                        value={formScriptPath}
                        onChange={e => setFormScriptPath(e.target.value)}
                        data-testid="script-template-edit-script"
                    />
                ) : (
                    <div className="mt-1">
                        <code className="text-sm text-[#1e1e1e] dark:text-[#cccccc] bg-[#f5f5f5] dark:bg-[#2a2a2a] px-2 py-1 rounded font-mono block" data-testid="script-template-script-value">
                            {template.scriptPath}
                        </code>
                    </div>
                )}
            </div>

            {/* Args */}
            {editing ? (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Args</label>
                    <input
                        className={cn(inputClass, "mt-1 font-mono")}
                        value={formArgs}
                        onChange={e => setFormArgs(e.target.value)}
                        data-testid="script-template-edit-args"
                    />
                </div>
            ) : template.args ? (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Args</label>
                    <div className="mt-1">
                        <code className="text-sm text-[#1e1e1e] dark:text-[#cccccc] bg-[#f5f5f5] dark:bg-[#2a2a2a] px-2 py-1 rounded font-mono block" data-testid="script-template-args-value">
                            {template.args}
                        </code>
                    </div>
                </div>
            ) : null}

            {/* Working Directory */}
            {editing ? (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Working Directory</label>
                    <input
                        className={cn(inputClass, "mt-1")}
                        value={formWorkingDirectory}
                        onChange={e => setFormWorkingDirectory(e.target.value)}
                        data-testid="script-template-edit-cwd"
                    />
                </div>
            ) : template.workingDirectory ? (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Working Directory</label>
                    <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]" data-testid="script-template-cwd-value">
                        {template.workingDirectory}
                    </p>
                </div>
            ) : null}

            {/* Model */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Model</label>
                {editing ? (
                    <input
                        className={cn(inputClass, "mt-1")}
                        value={formModel}
                        onChange={e => setFormModel(e.target.value)}
                        placeholder="default"
                        data-testid="script-template-edit-model"
                    />
                ) : (
                    <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]" data-testid="script-template-model-value">
                        {template.model || 'default'}
                    </p>
                )}
            </div>

            {/* Pause on Failure */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">Pause on Failure</label>
                {editing ? (
                    <div className="mt-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formPauseOnFailure}
                                onChange={e => setFormPauseOnFailure(e.target.checked)}
                                data-testid="script-template-edit-pause"
                            />
                            <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Pause on failure</span>
                        </label>
                    </div>
                ) : (
                    <div className="mt-1">
                        <span className={cn(
                            "px-2 py-0.5 text-xs rounded",
                            template.pauseOnFailure
                                ? "bg-[#fff3cd] dark:bg-[#4d3800] text-[#856404] dark:text-[#ffc107]"
                                : "bg-[#f0f0f0] dark:bg-[#2a2a2a] text-[#6e6e6e] dark:text-[#888]"
                        )} data-testid="script-template-pause-value">
                            {template.pauseOnFailure ? 'Yes' : 'No'}
                        </span>
                    </div>
                )}
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
                await getSpaCocClient().templates.update(workspaceId, editingTemplate!.name, {
                    description,
                    hints: parseHints(hintsText),
                });
            } else {
                await getSpaCocClient().templates.create(workspaceId, {
                    name,
                    kind,
                    commitHash: commitHash.trim(),
                    description,
                    hints: parseHints(hintsText),
                });
            }
            onSaved();
        } catch (error) {
            setError(getErrorMessage(error));
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

            {error && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5 mb-4" data-testid="template-form-error">
                    {error}
                </div>
            )}

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
            await getSpaCocClient().templates.replicate(workspaceId, template.name, {
                instruction: instruction.trim(),
                model: model || undefined,
            });
            onClose();
        } catch (error) {
            setError(getErrorMessage(error));
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
            <div className="mb-4 text-sm">
                <div className="text-[#6e6e6e] dark:text-[#888]">Template</div>
                <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{template.name}</div>
                <code className="text-xs font-mono text-[#6e6e6e]">{template.commitHash.slice(0, 12)}</code>
            </div>

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

            {error && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5" data-testid="replicate-error">
                    {error}
                </div>
            )}
        </Dialog>
    );
}

// ── CollapsibleSection ──

interface CollapsibleSectionProps {
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    actionButton?: React.ReactNode;
    children: React.ReactNode;
    testId?: string;
}

function CollapsibleSection({ label, count, expanded, onToggle, actionButton, children, testId }: CollapsibleSectionProps) {
    return (
        <div data-testid={testId}>
            <div
                className="flex items-center justify-between px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] cursor-pointer hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] select-none"
                onClick={onToggle}
            >
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#848484]">{expanded ? '▾' : '▸'}</span>
                    <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">{label}</span>
                    {count > 0 && (
                        <span className="text-xs text-[#848484]">({count})</span>
                    )}
                </div>
                {actionButton && (
                    <span onClick={e => e.stopPropagation()}>
                        {actionButton}
                    </span>
                )}
            </div>
            {expanded && children}
        </div>
    );
}

// ── Main component ──

interface TemplatesTabProps {
    repo: RepoData;
}

export function TemplatesTab({ repo }: TemplatesTabProps) {
    const { state, dispatch } = useApp();
    const workspaceId = repo.workspace.id;
    const pipelines = repo.workflows || [];

    // ── Workflow state ──
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
    const [workflowsExpanded, setWorkflowsExpanded] = useState(true);

    // ── Template state ──
    const [templates, setTemplates] = useState<Template[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
    const [templateDetail, setTemplateDetail] = useState<TemplateDetail | null>(null);
    const [templateDetailLoading, setTemplateDetailLoading] = useState(false);
    const [showTemplateCreate, setShowTemplateCreate] = useState(false);
    const [editingTemplateName, setEditingTemplateName] = useState<string | null>(null);
    const [replicateTarget, setReplicateTarget] = useState<Template | null>(null);
    const [templatesExpanded, setTemplatesExpanded] = useState(true);

    // ── AI Chat Template state ──
    const {
        templates: skillTemplates,
        deleteTemplate: deleteSkillTemplate,
        loaded: skillTemplatesLoaded,
    } = useSkillTemplates(workspaceId);
    const selectedSkillTemplateId = state.selectedSkillTemplateId;
    const [skillTemplatesExpanded, setSkillTemplatesExpanded] = useState(true);

    // ── Prompt & Script Template state ──
    const { templates: scriptTemplates, deleteTemplate: deleteScriptTemplate, updateTemplate: updateScriptTemplate, loaded: scriptTemplatesLoaded } = useScriptTemplates(workspaceId);

    const [editingScriptTemplateId, setEditingScriptTemplateId] = useState<string | null>(null);
    const selectedScriptTemplateId = state.selectedScriptTemplateId;
    const [scriptTemplatesExpanded, setScriptTemplatesExpanded] = useState(true);

    // ── Derived ──
    const selectedPipeline: WorkflowInfo | null =
        pipelines.find(p => p.name === state.selectedWorkflowName) ?? null;

    // ── Workflow handlers ──

    const handleSelectWorkflow = (p: WorkflowInfo) => {
        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: p.name });
        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
        setSelectedTemplateName(null);
        setShowTemplateCreate(false);
        setEditingTemplateName(null);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates/' + encodeURIComponent(p.name);
    };

    const handleCloseWorkflow = () => {
        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates';
    };

    const handleWorkflowDeleted = () => {
        handleCloseWorkflow();
    };

    const handleRunSuccess = () => {
        setHistoryRefreshKey(k => k + 1);
    };

    // ── Template API ──

    const fetchTemplates = useCallback(async () => {
        try {
            const nextTemplates = await getSpaCocClient().templates.list(workspaceId);
            setTemplates(nextTemplates);
        } catch {
            setTemplates([]);
        } finally {
            setTemplatesLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        if (!selectedTemplateName) { setTemplateDetail(null); return; }
        let cancelled = false;
        setTemplateDetailLoading(true);
        getSpaCocClient().templates.detail(workspaceId, selectedTemplateName)
            .then(data => {
                if (!cancelled) { setTemplateDetail(data); setTemplateDetailLoading(false); }
            })
            .catch(() => {
                if (!cancelled) { setTemplateDetail(null); setTemplateDetailLoading(false); }
            });
        return () => { cancelled = true; };
    }, [workspaceId, selectedTemplateName]);

    const handleDeleteTemplate = async (name: string) => {
        if (!confirm(`Delete template "${name}"?`)) return;
        await getSpaCocClient().templates.delete(workspaceId, name);
        if (selectedTemplateName === name) setSelectedTemplateName(null);
        fetchTemplates();
    };

    // ── Template WebSocket + mount ──

    useEffect(() => {
        const wsHandler = () => fetchTemplates();
        window.addEventListener('templates-changed', wsHandler);
        return () => window.removeEventListener('templates-changed', wsHandler);
    }, [workspaceId, fetchTemplates]);

    useEffect(() => {
        setTemplatesLoading(true);
        fetchTemplates();
    }, [workspaceId, fetchTemplates]);

    // ── Template selection handler ──

    const handleSelectTemplate = (name: string) => {
        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
        setSelectedTemplateName(name);
        setShowTemplateCreate(false);
        setEditingTemplateName(null);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates';
    };

    // ── Skill template handlers ──

    const handleSelectSkillTemplate = (id: string) => {
        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id });
        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
        setSelectedTemplateName(null);
        setShowTemplateCreate(false);
        setEditingTemplateName(null);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates/chat-template/' + encodeURIComponent(id);
    };

    const handleDeleteSkillTemplate = (id: string) => {
        if (!confirm('Delete this AI chat template?')) return;
        deleteSkillTemplate(id);
        if (selectedSkillTemplateId === id) {
            dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates';
        }
    };

    // ── Script template handlers ──

    const handleSelectScriptTemplate = (id: string) => {
        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id });
        setSelectedTemplateName(null);
        setShowTemplateCreate(false);
        setEditingTemplateName(null);
        setEditingScriptTemplateId(null);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates/script-template/' + encodeURIComponent(id);
    };

    const handleEditScriptTemplate = (id: string) => {
        handleSelectScriptTemplate(id);
        setEditingScriptTemplateId(id);
    };

    const handleDeleteScriptTemplate = (id: string) => {
        if (!confirm('Delete this prompt & script template?')) return;
        deleteScriptTemplate(id);
        if (selectedScriptTemplateId === id) {
            dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates';
        }
    };

    // ── Determine right panel content ──
    const showTemplatePanel = showTemplateCreate || editingTemplateName !== null
        || (selectedTemplateName !== null);

    return (
        <div className="flex h-full overflow-hidden">
            {/* LEFT PANEL */}
            <div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    {/* Workflows section */}
                    <CollapsibleSection
                        label="Workflows"
                        count={pipelines.length}
                        expanded={workflowsExpanded}
                        onToggle={() => setWorkflowsExpanded(v => !v)}
                        actionButton={
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={fetchTemplates} title="Refresh Workflows" data-testid="workflows-refresh-btn">↻</Button>
                                <Button variant="secondary" size="sm" onClick={() => setShowAddDialog(true)}>+ New</Button>
                            </div>
                        }
                        testId="workflows-section"
                    >
                        {pipelines.length === 0 ? (
                            <div className="empty-state p-4 text-center">
                                <div className="text-2xl mb-2">📋</div>
                                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">No workflows found</div>
                                <div className="text-xs text-[#848484] mt-1">
                                    Add YAML files to .vscode/workflows/ or create one below.
                                </div>
                            </div>
                        ) : (
                            <ul className="repo-workflow-list px-4 py-2 flex flex-col gap-1">
                                {pipelines.map(p => {
                                    const isActive = p.name === state.selectedWorkflowName;
                                    return (
                                        <li
                                            key={p.name}
                                            className={
                                                'repo-workflow-item flex items-center justify-between gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333]'
                                                + (isActive ? ' bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]' : '')
                                            }
                                            role="option"
                                            aria-selected={isActive}
                                            onClick={() => handleSelectWorkflow(p)}
                                        >
                                            <span className={'workflow-name text-sm text-[#1e1e1e] dark:text-[#cccccc]' + (isActive ? ' font-medium' : '')}>
                                                📋 {p.name}
                                            </span>
                                            <span className="repo-workflow-actions shrink-0" onClick={e => e.stopPropagation()}>
                                                <Button variant="secondary" size="sm" className="action-btn" onClick={() => handleSelectWorkflow(p)}>View</Button>
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </CollapsibleSection>

                    {/* Templates section */}
                    <CollapsibleSection
                        label="Templates"
                        count={templates.length}
                        expanded={templatesExpanded}
                        onToggle={() => setTemplatesExpanded(v => !v)}
                        actionButton={
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={fetchTemplates} title="Refresh Templates" data-testid="templates-refresh-btn">↻</Button>
                                <Button size="sm" onClick={() => {
                                    dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                                    setShowTemplateCreate(true);
                                    setEditingTemplateName(null);
                                    setSelectedTemplateName(null);
                                }} data-testid="templates-new-btn">
                                    + New
                                </Button>
                            </div>
                        }
                        testId="templates-section"
                    >
                        {templatesLoading ? (
                            <div className="flex items-center justify-center py-4">
                                <Spinner />
                            </div>
                        ) : templates.length === 0 ? (
                            <div className="flex items-center justify-center text-center px-4 py-4" data-testid="templates-empty">
                                <div>
                                    <div className="text-2xl mb-2">📋</div>
                                    <div className="text-sm text-[#6e6e6e] dark:text-[#888]">No templates yet</div>
                                    <div className="text-xs text-[#999] dark:text-[#666] mt-1">
                                        Create a template from a commit to replicate patterns
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <ul data-testid="templates-list">
                                {templates.map(t => (
                                    <TemplateListItem
                                        key={t.name}
                                        template={t}
                                        isSelected={selectedTemplateName === t.name}
                                        onSelect={() => handleSelectTemplate(t.name)}
                                        onEdit={() => {
                                            dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                                            setEditingTemplateName(t.name);
                                            setShowTemplateCreate(false);
                                        }}
                                        onReplicate={() => setReplicateTarget(t)}
                                        onDelete={() => handleDeleteTemplate(t.name)}
                                    />
                                ))}
                            </ul>
                        )}
                        {templates.length > 0 && (
                            <div className="px-4 pb-1 pt-1">
                                <span className="text-xs text-[#848484]" data-testid="templates-count">
                                    ({templates.length})
                                </span>
                            </div>
                        )}
                    </CollapsibleSection>

                    {/* AI Chat Templates section */}
                    <CollapsibleSection
                        label="AI Chat Templates"
                        count={skillTemplates.length}
                        expanded={skillTemplatesExpanded}
                        onToggle={() => setSkillTemplatesExpanded(v => !v)}
                        testId="skill-templates-section"
                    >
                        {!skillTemplatesLoaded ? (
                            <div className="flex items-center justify-center py-4">
                                <Spinner />
                            </div>
                        ) : skillTemplates.length === 0 ? (
                            <div className="flex items-center justify-center text-center px-4 py-4" data-testid="skill-templates-empty">
                                <div>
                                    <div className="text-2xl mb-2">🤖</div>
                                    <div className="text-sm text-[#6e6e6e] dark:text-[#888]">No AI chat templates</div>
                                    <div className="text-xs text-[#999] dark:text-[#666] mt-1">
                                        Save templates from the AI chat dialog
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <ul data-testid="skill-templates-list">
                                {skillTemplates.map(t => (
                                    <SkillTemplateListItem
                                        key={t.id}
                                        template={t}
                                        isSelected={selectedSkillTemplateId === t.id}
                                        onSelect={() => handleSelectSkillTemplate(t.id)}
                                        onDelete={() => handleDeleteSkillTemplate(t.id)}
                                    />
                                ))}
                            </ul>
                        )}
                    </CollapsibleSection>

                    {/* Prompt & Script Templates section */}
                    <CollapsibleSection
                        label="Prompt & Script Templates"
                        count={scriptTemplates.length}
                        expanded={scriptTemplatesExpanded}
                        onToggle={() => setScriptTemplatesExpanded(v => !v)}
                        testId="script-templates-section"
                    >
                        {!scriptTemplatesLoaded ? (
                            <div className="flex items-center justify-center py-4">
                                <Spinner />
                            </div>
                        ) : scriptTemplates.length === 0 ? (
                            <div className="flex items-center justify-center text-center px-4 py-4" data-testid="script-templates-empty">
                                <div>
                                    <div className="text-2xl mb-2">📜</div>
                                    <div className="text-sm text-[#6e6e6e] dark:text-[#888]">No prompt & script templates</div>
                                    <div className="text-xs text-[#999] dark:text-[#666] mt-1">
                                        Save templates from the Prompt & Script dialog
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <ul data-testid="script-templates-list">
                                {scriptTemplates.map((t: ScriptTemplate) => (
                                    <ScriptTemplateListItem
                                        key={t.id}
                                        template={t}
                                        isSelected={selectedScriptTemplateId === t.id}
                                        onSelect={() => handleSelectScriptTemplate(t.id)}
                                        onEdit={() => handleEditScriptTemplate(t.id)}
                                        onDelete={() => handleDeleteScriptTemplate(t.id)}
                                    />
                                ))}
                            </ul>
                        )}
                    </CollapsibleSection>
                </div>
            </div>

            {/* RIGHT PANEL */}
            <div className="flex-1 min-w-0 overflow-hidden">
                {selectedSkillTemplateId && skillTemplates.find(t => t.id === selectedSkillTemplateId) ? (
                    <div className="overflow-y-auto h-full">
                        <SkillTemplateDetailView
                            template={skillTemplates.find(t => t.id === selectedSkillTemplateId)!}
                            onDelete={() => handleDeleteSkillTemplate(selectedSkillTemplateId)}
                        />
                    </div>
                ) : selectedScriptTemplateId && scriptTemplates.find(t => t.id === selectedScriptTemplateId) ? (
                    <div className="overflow-y-auto h-full">
                        <ScriptTemplateDetailView
                            template={scriptTemplates.find(t => t.id === selectedScriptTemplateId)!}
                            workspaceId={workspaceId}
                            editing={editingScriptTemplateId === selectedScriptTemplateId}
                            onEdit={() => setEditingScriptTemplateId(selectedScriptTemplateId)}
                            onCancelEdit={() => setEditingScriptTemplateId(null)}
                            onUpdate={updateScriptTemplate}
                            onDelete={() => handleDeleteScriptTemplate(selectedScriptTemplateId)}
                        />
                    </div>
                ) : selectedPipeline && !showTemplatePanel ? (
                    <WorkflowDetail
                        workspaceId={workspaceId}
                        pipeline={selectedPipeline}
                        onClose={handleCloseWorkflow}
                        onDeleted={handleWorkflowDeleted}
                        onRunSuccess={handleRunSuccess}
                        refreshKey={historyRefreshKey}
                    />
                ) : showTemplateCreate || editingTemplateName ? (
                    <div className="overflow-y-auto h-full">
                        <CreateTemplateForm
                            workspaceId={workspaceId}
                            editingTemplate={editingTemplateName ? templates.find(t => t.name === editingTemplateName) : undefined}
                            onClose={() => { setShowTemplateCreate(false); setEditingTemplateName(null); }}
                            onSaved={() => {
                                setShowTemplateCreate(false);
                                setEditingTemplateName(null);
                                fetchTemplates();
                            }}
                        />
                    </div>
                ) : selectedTemplateName && templateDetail ? (
                    <div className="overflow-y-auto h-full">
                        <TemplateDetailView
                            template={templateDetail}
                            loading={templateDetailLoading}
                            onEdit={() => setEditingTemplateName(templateDetail.name)}
                            onReplicate={() => setReplicateTarget(templateDetail)}
                            onDelete={() => handleDeleteTemplate(templateDetail.name)}
                        />
                    </div>
                ) : selectedTemplateName && templateDetailLoading ? (
                    <div className="flex items-center justify-center h-full"><Spinner /></div>
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]" data-testid="templates-empty-detail">
                        Select a workflow or template
                    </div>
                )}
            </div>

            {showAddDialog && (
                <AddWorkflowDialog
                    workspaceId={workspaceId}
                    onCreated={(createdName?: string) => {
                        setShowAddDialog(false);
                        if (createdName) {
                            dispatch({ type: 'SET_SELECTED_WORKFLOW', name: createdName });
                            setSelectedTemplateName(null);
                            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/templates/' + encodeURIComponent(createdName);
                        }
                    }}
                    onClose={() => setShowAddDialog(false)}
                />
            )}

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
