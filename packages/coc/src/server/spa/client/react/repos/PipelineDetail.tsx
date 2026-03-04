/**
 * PipelineDetail — view/edit panel for a single pipeline's YAML content.
 */

import { useState, useEffect } from 'react';
import { Button, Badge, Dialog, Spinner, cn } from '../shared';
import { useGlobalToast } from '../context/ToastContext';
import { useQueue } from '../context/QueueContext';
import { fetchPipelineContent, savePipelineContent, deletePipeline, runPipeline } from './pipeline-api';
import { PipelineRunHistory } from './PipelineRunHistory';
import { PipelineDAGPreview } from './PipelineDAGPreview';
import { PipelineAIRefinePanel } from './PipelineAIRefinePanel';
import type { PipelineInfo } from './repoGrouping';

export interface PipelineDetailProps {
    workspaceId: string;
    pipeline: PipelineInfo;
    onClose: () => void;
    onDeleted: () => void;
    onRunSuccess?: () => void;
    refreshKey?: number;
}

export function PipelineDetail({ workspaceId, pipeline, onClose, onDeleted, onRunSuccess, refreshKey }: PipelineDetailProps) {
    const { addToast } = useGlobalToast();
    const { state: queueState } = useQueue();
    const [mode, setMode] = useState<'view' | 'edit' | 'ai-edit'>('view');
    const [activeTab, setActiveTab] = useState<'pipeline' | 'history'>('pipeline');
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
            t.type === 'run-pipeline' && (
                t.metadata?.pipelineName === pipeline.name ||
                t.displayName?.includes(pipeline.name)
            )
    ).length;

    useEffect(() => {
        let cancelled = false;
        fetchPipelineContent(workspaceId, pipeline.name)
            .then(data => {
                if (cancelled) return;
                setContent(data.content);
                setEditContent(data.content);
            })
            .catch(err => {
                if (cancelled) return;
                addToast(`Failed to load pipeline: ${err.message}`, 'error');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [workspaceId, pipeline.name]);

    async function handleRun() {
        setRunning(true);
        try {
            const data = await runPipeline(workspaceId, pipeline.name);
            const taskIdShort = data.task?.id ? data.task.id.slice(0, 8) : '';
            addToast(`Pipeline queued${taskIdShort ? ` (${taskIdShort})` : ''}`, 'success');
            onRunSuccess?.();
        } catch (err: any) {
            addToast(`Failed to run pipeline: ${err.message}`, 'error');
        } finally {
            setRunning(false);
        }
    }

    async function handleSave() {
        if (editContent.trim() === '') {
            setError('Pipeline content cannot be empty');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await savePipelineContent(workspaceId, pipeline.name, editContent);
            setContent(editContent);
            setMode('view');
            addToast('Pipeline saved', 'success');
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
            await savePipelineContent(workspaceId, pipeline.name, newYaml);
            setContent(newYaml);
            setEditContent(newYaml);
            setMode('view');
            addToast('Pipeline saved', 'success');
        } catch (err: any) {
            setError(err.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        try {
            await deletePipeline(workspaceId, pipeline.name);
            addToast('Pipeline deleted', 'success');
            onDeleted();
        } catch (err: any) {
            addToast(`Failed to delete pipeline: ${err.message}`, 'error');
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
                                title={pipeline.isValid === false ? 'Fix validation errors before running' : 'Run pipeline'}
                                data-testid="pipeline-run-btn"
                                onClick={handleRun}
                            >
                                ▶ Run
                            </Button>
                            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                            <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>Edit</Button>
                            <Button variant="secondary" size="sm" onClick={() => setMode('ai-edit')}>Edit with AI ✨</Button>
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
                        </>
                    ) : mode === 'ai-edit' ? (
                        null
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
                <div className="flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4" data-testid="pipeline-tab-bar">
                    {(['pipeline', 'history'] as const).map(tab => (
                        <button
                            key={tab}
                            data-tab={tab}
                            className={cn(
                                'pipeline-tab px-3 py-2 text-xs font-medium transition-colors relative',
                                activeTab === tab
                                    ? 'active text-[#0078d4] dark:text-[#3794ff]'
                                    : 'text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                            )}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab === 'pipeline' ? 'Pipeline' : 'Run History'}
                            {tab === 'history' && activeTaskCount > 0 && (
                                <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="active-task-badge">{activeTaskCount}</span>
                            )}
                            {activeTab === tab && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Content area */}
            <div className="flex-1 overflow-auto px-4">
                {mode === 'view' ? (
                    <>
                        {activeTab === 'pipeline' && (
                            <>
                                <pre className="font-mono text-xs overflow-auto whitespace-pre-wrap bg-[#f5f5f5] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3">
                                    {content}
                                </pre>
                                {content && (
                                    <PipelineDAGPreview yamlContent={content} validationErrors={pipeline.validationErrors} />
                                )}
                            </>
                        )}
                        {activeTab === 'history' && (
                            <PipelineRunHistory
                                workspaceId={workspaceId}
                                pipelineName={pipeline.name}
                                refreshKey={refreshKey}
                            />
                        )}
                    </>
                ) : mode === 'ai-edit' ? (
                    <PipelineAIRefinePanel
                        workspaceId={workspaceId}
                        pipelineName={pipeline.name}
                        currentYaml={content}
                        onApply={handleAIApply}
                        onCancel={() => setMode('view')}
                    />
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

            {/* Delete confirmation dialog */}
            <Dialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title="Delete Pipeline"
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
