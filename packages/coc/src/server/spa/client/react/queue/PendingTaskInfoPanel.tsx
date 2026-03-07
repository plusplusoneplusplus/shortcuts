import { useEffect, useState } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Button, Spinner } from '../shared';
import { PendingTaskPayload, MetaRow, FilePathValue } from './PendingTaskPayload';

export interface PendingTaskInfoPanelProps {
    task: any;
    onCancel: () => void;
    onMoveToTop: () => void;
}

export function PendingTaskInfoPanel({ task, onCancel, onMoveToTop }: PendingTaskInfoPanelProps) {
    const [resolvedPrompt, setResolvedPrompt] = useState<any>(null);

    useEffect(() => {
        if (!task?.id) return;
        fetchApi('/queue/' + encodeURIComponent(task.id) + '/resolved-prompt')
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
    const workingDir = task.payload?.workingDirectory || '';
    const repoId = task.repoId || '';

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
                {created && <MetaRow label="Created" value={created} />}
                {model && <MetaRow label="Model" value={model} />}
                {workingDir && <FilePathValue label="Working Directory" value={workingDir} />}
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
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                {resolvedPrompt.planFileContent}
                            </pre>
                        </div>
                    )}
                    {resolvedPrompt.promptFileContent && (
                        <div className="mt-2">
                            <span className="text-xs text-[#848484] font-semibold">Prompt File Content</span>
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                {resolvedPrompt.promptFileContent}
                            </pre>
                        </div>
                    )}
                    {resolvedPrompt.resolvedPrompt && !resolvedPrompt.planFileContent && !resolvedPrompt.promptFileContent && (
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
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
