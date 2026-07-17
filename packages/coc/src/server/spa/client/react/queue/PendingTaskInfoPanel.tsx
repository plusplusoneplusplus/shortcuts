import { useEffect, useState } from 'react';
import { getSpaCocClient } from '../api/cocClient';
import { Button, Spinner } from '../ui';
import { PendingTaskPayload, MetaRow, FilePathValue } from './PendingTaskPayload';
import { useQueue } from '../contexts/QueueContext';
import { ProviderBadge, getTaskProviderBadgeProvider } from '../features/chat/ProviderBadge';

export interface PendingTaskInfoPanelProps {
    task: any;
    onCancel: () => void;
    onMoveToTop: () => void;
}

export function PendingTaskInfoPanel({ task, onCancel, onMoveToTop }: PendingTaskInfoPanelProps) {
    const [resolvedPrompt, setResolvedPrompt] = useState<any>(null);
    const { state: queueState } = useQueue();

    const queuePosition = task?.id
        ? queueState.queued.findIndex((t: any) => t.id === task.id) + 1
        : 0;
    const queueTotal = queueState.queued.length;

    useEffect(() => {
        if (!task?.id) return;
        getSpaCocClient().queue.resolvedPrompt(task.id)
            .then((data: any) => { if (data) setResolvedPrompt(data); })
            .catch(() => { /* non-fatal */ });
    }, [task?.id]);

    if (!task) {
        return (
            <div className="flex items-center gap-2 text-[#848484] text-sm">
                <Spinner size="sm" /> Loading task info...
            </div>
        );
    }

    const name = task.displayName || task.type || 'Pending Task';
    const priorityIcons: Record<string, string> = { high: '🔥', normal: '➖', low: '🔽' };
    const priorityLabel = task.priority || 'normal';
    const created = task.createdAt ? new Date(task.createdAt).toLocaleString() : '';
    const model = task.config?.model || '';
    // `effortTier` is consumed at enqueue; `afterEffortTier` is what survives on
    // the task config. Auto tasks have no model until execution picks a provider,
    // so the tier is the only honest thing to show in the Model row's place.
    const effortTier = task.config?.afterEffortTier || task.config?.effortTier || '';
    const workingDir = task.payload?.workingDirectory || '';
    const planFilePath = task.payload?.planFilePath || '';
    const filePath = task.payload?.filePath || '';
    const workflowPath = task.payload?.workflowPath || '';
    const repoId = task.repoId || '';
    const providerBadgeProvider = getTaskProviderBadgeProvider(task);

    return (
        <div className="pending-task-info space-y-5">
            {/* Name */}
            <div className="flex items-center gap-2">
                <span className="text-2xl">⏳</span>
                <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#cccccc] m-0">{name}</h2>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
                <MetaRow label="Task ID" value={task.id} />
                <MetaRow label="Type" value={task.type || 'unknown'} />
                <MetaRow label="Priority" value={`${priorityIcons[priorityLabel] || ''} ${priorityLabel}`} />
                {queuePosition > 0 && <MetaRow label="Queue Position" value={`${queuePosition} of ${queueTotal}`} />}
                {created && <MetaRow label="Created" value={created} />}
                {model && <MetaRow label="Model" value={model} />}
                {effortTier && <MetaRow label="Effort Tier" value={effortTier} />}
                {providerBadgeProvider && (
                    <>
                        <span className="text-[#848484]">Provider</span>
                        <span><ProviderBadge provider={providerBadgeProvider} /></span>
                    </>
                )}
                {workingDir && <FilePathValue label="Working Directory" value={workingDir} />}
                {planFilePath && <FilePathValue label="Plan File" value={planFilePath} />}
                {filePath && <FilePathValue label="File" value={filePath} />}
                {workflowPath && <FilePathValue label="Workflow" value={workflowPath} />}
                {repoId && <MetaRow label="Repo ID" value={repoId} breakAll />}
            </div>

            {/* Prompt / Payload */}
            <PendingTaskPayload task={task} />

            {/* Resolved Prompt (async-loaded) */}
            {resolvedPrompt && (resolvedPrompt.resolvedPrompt || resolvedPrompt.planFileContent || resolvedPrompt.promptFileContent) && (
                <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Full Prompt (Resolved)</summary>
                    {resolvedPrompt.planFileContent && (
                        <div className="mt-2">
                            <span className="text-xs text-[#848484] font-semibold">Plan File Content</span>
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                {resolvedPrompt.planFileContent}
                            </pre>
                        </div>
                    )}
                    {resolvedPrompt.promptFileContent && (
                        <div className="mt-2">
                            <span className="text-xs text-[#848484] font-semibold">Prompt File Content</span>
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                {resolvedPrompt.promptFileContent}
                            </pre>
                        </div>
                    )}
                    {resolvedPrompt.resolvedPrompt && !resolvedPrompt.planFileContent && !resolvedPrompt.promptFileContent && (
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                            {resolvedPrompt.resolvedPrompt}
                        </pre>
                    )}
                </details>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
                <Button variant="danger" size="sm" onClick={onCancel}>Cancel Task</Button>
                <Button variant="secondary" size="sm" onClick={onMoveToTop}>Move to Top</Button>
            </div>
        </div>
    );
}
