/**
 * WorkflowDetail — view/edit panel for a single pipeline's YAML content.
 */

import { useState, useEffect } from 'react';
import { Button, Badge, Dialog, Spinner, cn } from '../shared';
import { useGlobalToast } from '../context/ToastContext';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { fetchWorkflowContent, saveWorkflowContent, deleteWorkflow, runWorkflow } from './workflow-api';
import { WorkflowRunHistory } from './WorkflowRunHistory';
import { WorkflowDAGPreview } from './WorkflowDAGPreview';
import { WorkflowAIRefinePanel } from './WorkflowAIRefinePanel';
import { WorkflowDetailView } from '../processes/dag/WorkflowDetailView';
import type { WorkflowInfo } from './repoGrouping';

export interface WorkflowDetailProps {
    workspaceId: string;
    pipeline: WorkflowInfo;
    onClose: () => void;
    onDeleted: () => void;
    onRunSuccess?: () => void;
    refreshKey?: number;
}

export function WorkflowDetail({ workspaceId, pipeline, onClose, onDeleted, onRunSuccess, refreshKey }: WorkflowDetailProps) {
    const { addToast } = useGlobalToast();
    const { state: queueState } = useQueue();
    const { state: appState } = useApp();
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'pipeline' | 'history'>('pipeline');
    const selectedRunProcessId = appState.selectedWorkflowRunProcessId;
    // Derive effective tab: when a run is selected, show 'run' regardless of local activeTab
    const effectiveTab = selectedRunProcessId ? 'run' : activeTab;
    const [content, setContent] = useState('');
    const [editContent, setEditContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const repoQueue = queueState.repoQueueMap[workspaceId];
    const activeTaskCount = [...(repoQueue?.running || []), ...(repoQueue?.queued || [])].filter(
        (t: any) =>
            t.type === 'run-workflow' && (
                t.metadata?.pipelineName === pipeline.name ||
                t.displayName?.includes(pipeline.name)
            )
    ).length;

    useEffect(() => {
        let cancelled = false;
        fetchWorkflowContent(workspaceId, pipeline.name)
            .then(data => {
                if (cancelled) return;
                setContent(data.content);
                setEditContent(data.content);
            })
            .catch(err => {
                if (cancelled) return;
                addToast(`Failed to load workflow: ${err.message}`, 'error');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [workspaceId, pipeline.name]);

    async function handleRun() {
        setRunning(true);
        try {
            const data = await runWorkflow(workspaceId, pipeline.name);
            const taskIdShort = data.task?.id ? data.task.id.slice(0, 8) : '';
            addToast(`Workflow queued${taskIdShort ? ` (${taskIdShort})` : ''}`, 'success');
            onRunSuccess?.();
        } catch (err: any) {
            addToast(`Failed to run workflow: ${err.message}`, 'error');
        } finally {
            setRunning(false);
        }
    }

    async function handleSave() {
        if (editContent.trim() === '') {
            setError('Workflow content cannot be empty');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await saveWorkflowContent(workspaceId, pipeline.name, editContent);
            setContent(editContent);
            setMode('view');
            addToast('Workflow saved', 'success');
        } catch (err: any) {
            setError(err.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    }

    async function handleAIApply(newYaml: string) {
        setSaving(true);
        setError(null);
        try {
            await saveWorkflowContent(workspaceId, pipeline.name, newYaml);
            setContent(newYaml);
            setEditContent(newYaml);
            addToast('Workflow updated ✓', 'success');
        } catch (err: any) {
            setError(err.message || 'Failed to save');
            throw err;
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        try {
            await deleteWorkflow(workspaceId, pipeline.name);
            addToast('Workflow deleted', 'success');
            onDeleted();
        } catch (err: any) {
            addToast(`Failed to delete workflow: ${err.message}`, 'error');
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Spinner size="md" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{pipeline.name}</span>
                <span className="text-xs font-mono text-[#848484]">{pipeline.path}</span>
                {mode === 'view' && pipeline.isValid === true && (
                    <Badge status="completed">✅ Valid</Badge>
                )}
                {mode === 'view' && pipeline.isValid === false && (
                    <Badge status="warning">⚠️ Invalid</Badge>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    {mode === 'view' ? (
                        <>
                            <Button
                                size="sm"
                                loading={running}
                                disabled={pipeline.isValid === false}
                                title={pipeline.isValid === false ? 'Fix validation errors before running' : 'Run workflow'}
                                data-testid="workflow-run-btn"
                                onClick={handleRun}
                            >
                                ▶ Run
                            </Button>
                            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                            <Button variant="secondary" size="sm" onClick={() => { setMode('edit'); setAiSidebarOpen(false); }}>Edit</Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setAiSidebarOpen(prev => !prev)}
                                data-testid="ai-sidebar-toggle"
                            >
                                {aiSidebarOpen ? 'Close AI ✨' : 'Edit with AI ✨'}
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="secondary" size="sm" onClick={() => { setMode('view'); setError(null); }}>Cancel</Button>
                            <Button size="sm" loading={saving} onClick={handleSave}>Save</Button>
                        </>
                    )}
                </div>
            </div>

            {/* Validation errors */}
            {mode === 'view' && pipeline.validationErrors && pipeline.validationErrors.length > 0 && (
                <div className="px-4 pb-2">
                    <details className="text-xs text-[#848484]">
                        <summary className="cursor-pointer">Validation errors ({pipeline.validationErrors.length})</summary>
                        <ul className="mt-1 ml-4 list-disc">
                            {pipeline.validationErrors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    </details>
                </div>
            )}

            {/* Tab bar (view mode only) */}
            {mode === 'view' && (
                <div className="flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4" data-testid="workflow-tab-bar">
                    {(['pipeline', 'history'] as const).map(tab => (
                        <button
                            key={tab}
                            data-tab={tab}
                            className={cn(
                                'pipeline-tab px-3 py-2 text-xs font-medium transition-colors relative',
                                effectiveTab === tab
                                    ? 'active text-[#0078d4] dark:text-[#3794ff]'
                                    : 'text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                            )}
                            onClick={() => {
                                setActiveTab(tab);
                                if (selectedRunProcessId) {
                                    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/pipelines/' + encodeURIComponent(pipeline.name);
                                }
                            }}
                        >
                            {tab === 'pipeline' ? 'Workflow' : 'Run History'}
                            {tab === 'history' && activeTaskCount > 0 && (
                                <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="active-task-badge">{activeTaskCount}</span>
                            )}
                            {effectiveTab === tab && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                            )}
                        </button>
                    ))}
                    {selectedRunProcessId && (
                        <button
                            key="run"
                            data-tab="run"
                            className={cn(
                                'pipeline-tab px-3 py-2 text-xs font-medium transition-colors relative',
                                'active text-[#0078d4] dark:text-[#3794ff]'
                            )}
                        >
                            Run Detail
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                        </button>
                    )}
                </div>
            )}

            {/* Content area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Main content panel */}
                <div className="flex-1 overflow-auto px-4 min-w-0">
                    {mode === 'view' ? (
                        <>
                            {effectiveTab === 'pipeline' && (
                                <>
                                    <pre className="font-mono text-xs overflow-auto whitespace-pre-wrap bg-[#f5f5f5] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3">
                                        {content}
                                    </pre>
                                    {content && (
                                        <WorkflowDAGPreview yamlContent={content} validationErrors={pipeline.validationErrors} />
                                    )}
                                </>
                            )}
                            {effectiveTab === 'history' && (
                                <WorkflowRunHistory
                                    workspaceId={workspaceId}
                                    pipelineName={pipeline.name}
                                    refreshKey={refreshKey}
                                />
                            )}
                            {effectiveTab === 'run' && selectedRunProcessId && (
                                <WorkflowDetailView processId={selectedRunProcessId} />
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col gap-2 h-full">
                            <textarea
                                className="flex-1 w-full font-mono text-xs p-3 border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-none min-h-[200px]"
                                value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                            />
                            {error && <p className="text-xs text-red-500">{error}</p>}
                        </div>
                    )}
                </div>

                {/* AI Edit sidebar */}
                {aiSidebarOpen && mode === 'view' && (
                    <div
                        className="w-[400px] shrink-0 flex flex-col border-l border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f9f9f9] dark:bg-[#1e1e1e]"
                        data-testid="ai-sidebar"
                    >
                        <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">✨ Edit with AI</span>
                                <span className="text-xs text-[#848484]">{pipeline.name}</span>
                            </div>
                            <button
                                className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none p-1"
                                onClick={() => setAiSidebarOpen(false)}
                                data-testid="ai-sidebar-close"
                                title="Close AI sidebar"
                            >
                                ×
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-3">
                            <WorkflowAIRefinePanel
                                workspaceId={workspaceId}
                                pipelineName={pipeline.name}
                                currentYaml={content}
                                onApply={handleAIApply}
                                onCancel={() => setAiSidebarOpen(false)}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Delete confirmation dialog */}
            <Dialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title="Delete Workflow"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                        <Button variant="danger" onClick={handleDelete}>Confirm</Button>
                    </>
                }
            >
                Are you sure you want to delete &ldquo;{pipeline.name}&rdquo;? This cannot be undone.
            </Dialog>
        </div>
    );
}
