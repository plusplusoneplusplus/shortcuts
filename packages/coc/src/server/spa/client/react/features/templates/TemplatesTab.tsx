/**
 * TemplatesTab — two-panel layout with collapsible Workflows, Templates,
 * AI Chat Templates, and Prompt & Script Templates sections.
 *
 * Commit-template list/detail/create/edit/replicate behavior is shared with RepoTemplatesTab
 * through the commit-templates module (useCommitTemplatesController + presentational
 * components). The four mutually exclusive selection domains (workflow, commit, AI chat,
 * prompt/script) are transitioned through the pure reduceTemplatesPanel reducer so selecting
 * one always clears the others and keeps the route hash consistent.
 */

import { useState, useEffect } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { Button, cn, Spinner } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useGlobalToast } from '../../contexts/ToastContext';
import type { RepoData, WorkflowInfo } from '../../repos/repoGrouping';
import { WorkflowDetail } from '../workflow/WorkflowDetail';
import { AddWorkflowDialog } from '../workflow/AddWorkflowDialog';
import { useSkillTemplates } from './hooks/useSkillTemplates';
import type { SkillTemplate } from './hooks/useSkillTemplates';
import { useScriptTemplates } from './hooks/useScriptTemplates';
import type { ScriptTemplate } from './hooks/useScriptTemplates';
import {
    ContextMenu,
    TemplateListItem,
    TemplateDetailView,
    CreateTemplateForm,
    ReplicateDialog,
    useCommitTemplatesController,
    reduceTemplatesPanel,
    templatesPanelHash,
    EMPTY_TEMPLATES_PANEL_SELECTION,
} from './commit-templates';
import type { TemplatesPanelAction, TemplatesPanelSelection } from './commit-templates';

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

    // ── Commit template state (shared controller) ──
    const commit = useCommitTemplatesController(workspaceId);
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

    // ── Mutually exclusive selection transitions (pure reducer + centralized hash) ──

    const applySelection = (action: TemplatesPanelAction) => {
        const current: TemplatesPanelSelection = {
            workflowName: state.selectedWorkflowName,
            commitTemplateName: commit.selectedName,
            skillTemplateId: selectedSkillTemplateId,
            scriptTemplateId: selectedScriptTemplateId,
            showCommitCreate: commit.showCreate,
            editingCommitName: commit.editingName,
            editingScriptId: editingScriptTemplateId,
        };
        const next = reduceTemplatesPanel(current, action);
        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: next.workflowName });
        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: next.skillTemplateId });
        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: next.scriptTemplateId });
        commit.setSelectedName(next.commitTemplateName);
        commit.setShowCreate(next.showCommitCreate);
        commit.setEditingName(next.editingCommitName);
        setEditingScriptTemplateId(next.editingScriptId);
        location.hash = templatesPanelHash(workspaceId, next);
    };

    // ── Workflow handlers ──

    const handleSelectWorkflow = (p: WorkflowInfo) => applySelection({ type: 'select-workflow', name: p.name });
    const handleCloseWorkflow = () => applySelection({ type: 'close-workflow' });
    const handleWorkflowDeleted = () => handleCloseWorkflow();
    const handleRunSuccess = () => setHistoryRefreshKey(k => k + 1);

    // ── Commit template handlers ──

    const handleSelectTemplate = (name: string) => applySelection({ type: 'select-commit', name });

    // ── Skill template handlers ──

    const handleSelectSkillTemplate = (id: string) => applySelection({ type: 'select-skill', id });

    const handleDeleteSkillTemplate = (id: string) => {
        if (!confirm('Delete this AI chat template?')) return;
        deleteSkillTemplate(id);
        if (selectedSkillTemplateId === id) {
            dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
            location.hash = templatesPanelHash(workspaceId, EMPTY_TEMPLATES_PANEL_SELECTION);
        }
    };

    // ── Script template handlers ──

    const handleSelectScriptTemplate = (id: string) => applySelection({ type: 'select-script', id });

    const handleEditScriptTemplate = (id: string) => applySelection({ type: 'edit-script', id });

    const handleDeleteScriptTemplate = (id: string) => {
        if (!confirm('Delete this prompt & script template?')) return;
        deleteScriptTemplate(id);
        if (selectedScriptTemplateId === id) {
            dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
            location.hash = templatesPanelHash(workspaceId, EMPTY_TEMPLATES_PANEL_SELECTION);
        }
    };

    // ── Determine right panel content ──
    const showTemplatePanel = commit.showCreate || commit.editingName !== null
        || (commit.selectedName !== null);

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
                                <Button variant="ghost" size="sm" onClick={commit.fetchTemplates} title="Refresh Workflows" data-testid="workflows-refresh-btn">↻</Button>
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
                        count={commit.templates.length}
                        expanded={templatesExpanded}
                        onToggle={() => setTemplatesExpanded(v => !v)}
                        actionButton={
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={commit.fetchTemplates} title="Refresh Templates" data-testid="templates-refresh-btn">↻</Button>
                                <Button size="sm" onClick={() => applySelection({ type: 'create-commit' })} data-testid="templates-new-btn">
                                    + New
                                </Button>
                            </div>
                        }
                        testId="templates-section"
                    >
                        {commit.loading ? (
                            <div className="flex items-center justify-center py-4">
                                <Spinner />
                            </div>
                        ) : commit.templates.length === 0 ? (
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
                                {commit.templates.map(t => (
                                    <TemplateListItem
                                        key={t.name}
                                        template={t}
                                        isSelected={commit.selectedName === t.name}
                                        onSelect={() => handleSelectTemplate(t.name)}
                                        onEdit={() => applySelection({ type: 'edit-commit', name: t.name })}
                                        onReplicate={() => commit.setReplicateTarget(t)}
                                        onDelete={() => commit.handleDelete(t.name)}
                                    />
                                ))}
                            </ul>
                        )}
                        {commit.templates.length > 0 && (
                            <div className="px-4 pb-1 pt-1">
                                <span className="text-xs text-[#848484]" data-testid="templates-count">
                                    ({commit.templates.length})
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
                ) : commit.showCreate || commit.editingName ? (
                    <div className="overflow-y-auto h-full">
                        <CreateTemplateForm
                            workspaceId={workspaceId}
                            editingTemplate={commit.editingTemplate}
                            onClose={commit.closeForm}
                            onSaved={() => {
                                commit.closeForm();
                                commit.fetchTemplates();
                            }}
                        />
                    </div>
                ) : commit.selectedName && commit.detail ? (
                    <div className="overflow-y-auto h-full">
                        <TemplateDetailView
                            template={commit.detail}
                            loading={commit.detailLoading}
                            onEdit={() => applySelection({ type: 'edit-commit', name: commit.detail!.name })}
                            onReplicate={() => commit.setReplicateTarget(commit.detail)}
                            onDelete={() => commit.handleDelete(commit.detail!.name)}
                        />
                    </div>
                ) : commit.selectedName && commit.detailLoading ? (
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
                            applySelection({ type: 'select-workflow', name: createdName });
                        }
                    }}
                    onClose={() => setShowAddDialog(false)}
                />
            )}

            {commit.replicateTarget && (
                <ReplicateDialog
                    workspaceId={workspaceId}
                    template={commit.replicateTarget}
                    onClose={() => commit.setReplicateTarget(null)}
                />
            )}
        </div>
    );
}
