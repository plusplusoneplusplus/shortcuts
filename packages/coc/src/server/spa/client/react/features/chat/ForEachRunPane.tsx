import type { ForEachItemStatus, ForEachRun, ForEachRunStatus } from '@plusplusoneplusplus/coc-client';
import { TaskGroupRunPane, type TaskGroupRunPaneConfig } from './TaskGroupRunPane';

export interface ForEachRunPaneProps {
    workspaceId: string;
    runId: string;
    onClose?: () => void;
    onSelectGenerationProcess?: (processId: string) => void;
    onSelectChildProcess?: (processId: string) => void;
}

const RUN_STATUS_CLASS: Record<ForEachRunStatus, string> = {
    draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    approved: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100',
};

const ITEM_STATUS_CLASS: Record<ForEachItemStatus, string> = {
    pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
    skipped: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
};

function canCancel(run: ForEachRun): boolean {
    return run.status === 'draft' || run.status === 'approved' || run.status === 'running' || run.status === 'failed';
}

function canContinue(run: ForEachRun): boolean {
    if (run.status !== 'approved' && run.status !== 'running') return false;
    return !run.items.some(item => item.status === 'running')
        && !run.items.some(item => item.status === 'failed')
        && run.items.some(item => item.status === 'pending');
}

const FOR_EACH_PANE_CONFIG: TaskGroupRunPaneConfig<ForEachRun> = {
    testIdPrefix: 'for-each',
    label: 'For Each',
    itemColumnHeader: 'Item',
    childChatLabel: 'Open child chat',
    generationButtonClassName: 'border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900/60',
    primaryButtonClassName: 'border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-100',
    childLinkClassName: 'border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-200 dark:hover:bg-sky-950/40',
    runStatusClassName: status => RUN_STATUS_CLASS[status],
    itemStatusClassName: status => ITEM_STATUS_CLASS[status as ForEachItemStatus],
    canCancel,
    canStartOrContinue: canContinue,
    api: {
        get: (client, workspaceId, runId) => client.forEach.get(workspaceId, runId),
        start: (client, workspaceId, runId) => client.forEach.start(workspaceId, runId),
        continue: (client, workspaceId, runId) => client.forEach.continue(workspaceId, runId),
        cancel: (client, workspaceId, runId) => client.forEach.cancel(workspaceId, runId),
        retryItem: (client, workspaceId, runId, itemId) => client.forEach.retryItem(workspaceId, runId, itemId),
        skipItem: (client, workspaceId, runId, itemId) => client.forEach.skipItem(workspaceId, runId, itemId),
    },
};

export function ForEachRunPane(props: ForEachRunPaneProps) {
    return <TaskGroupRunPane {...props} config={FOR_EACH_PANE_CONFIG} />;
}
