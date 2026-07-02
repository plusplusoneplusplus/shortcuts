import type {
    MapReduceItemStatus,
    MapReduceReduceStep,
    MapReduceReduceStepStatus,
    MapReduceRun,
    MapReduceRunStatus,
} from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui/cn';
import {
    TaskGroupRunPane,
    type TaskGroupRunPaneActionContext,
    type TaskGroupRunPaneConfig,
} from './TaskGroupRunPane';

export interface MapReduceRunPaneProps {
    workspaceId: string;
    runId: string;
    onClose?: () => void;
    onSelectGenerationProcess?: (processId: string) => void;
    onSelectChildProcess?: (processId: string) => void;
}

const RUN_STATUS_CLASS: Record<MapReduceRunStatus, string> = {
    draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    approved: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-100',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    reducing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-100',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100',
};

const ITEM_STATUS_CLASS: Record<MapReduceItemStatus, string> = {
    pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
    skipped: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
};

const REDUCE_STATUS_CLASS: Record<MapReduceReduceStepStatus, string> = {
    pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    running: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-100',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
    cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100',
};

function canCancel(run: MapReduceRun): boolean {
    return run.status === 'draft' || run.status === 'approved' || run.status === 'running' || run.status === 'reducing' || run.status === 'failed';
}

function canStartOrContinue(run: MapReduceRun): boolean {
    if (run.status === 'approved') return true;
    if (run.status === 'running') {
        return !run.items.some(item => item.status === 'running')
            && !run.items.some(item => item.status === 'failed')
            && run.items.some(item => item.status === 'pending');
    }
    if (run.status === 'reducing') {
        return run.reduceStep.status === 'pending';
    }
    return false;
}

const MAP_REDUCE_PANE_CONFIG: TaskGroupRunPaneConfig<MapReduceRun> = {
    testIdPrefix: 'map-reduce',
    label: 'Map Reduce',
    itemColumnHeader: 'Map item',
    childChatLabel: 'Open map chat',
    generationButtonClassName: 'border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100 dark:hover:bg-indigo-900/60',
    primaryButtonClassName: 'border-indigo-500 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-100',
    childLinkClassName: 'border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-200 dark:hover:bg-indigo-950/40',
    runStatusClassName: status => RUN_STATUS_CLASS[status],
    itemStatusClassName: status => ITEM_STATUS_CLASS[status as MapReduceItemStatus],
    canCancel,
    canStartOrContinue,
    api: {
        get: (client, workspaceId, runId) => client.mapReduce.get(workspaceId, runId),
        start: (client, workspaceId, runId) => client.mapReduce.start(workspaceId, runId),
        continue: (client, workspaceId, runId) => client.mapReduce.continue(workspaceId, runId),
        cancel: (client, workspaceId, runId) => client.mapReduce.cancel(workspaceId, runId),
        retryItem: (client, workspaceId, runId, itemId) => client.mapReduce.retryItem(workspaceId, runId, itemId),
        skipItem: (client, workspaceId, runId, itemId) => client.mapReduce.skipItem(workspaceId, runId, itemId),
    },
    renderHeaderMeta: run => (
        <>
            <span>Reduce: {run.reduceStep.status}</span>
            <span>Max parallel: {run.maxParallel}</span>
        </>
    ),
    renderExtraSections: (run, ctx) => <ReduceStepSection run={run} ctx={ctx} />,
};

export function MapReduceRunPane(props: MapReduceRunPaneProps) {
    return <TaskGroupRunPane {...props} config={MAP_REDUCE_PANE_CONFIG} />;
}

interface ReduceStepSectionProps {
    run: MapReduceRun;
    ctx: TaskGroupRunPaneActionContext;
}

function ReduceStepSection({ run, ctx }: ReduceStepSectionProps) {
    return (
        <section className="mb-3 rounded border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20" data-testid="map-reduce-reduce-step">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-900 dark:text-indigo-100">Reduce step</h3>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-indigo-900/80 dark:text-indigo-100/80">{run.reduceInstructions}</p>
                </div>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', REDUCE_STATUS_CLASS[run.reduceStep.status])} data-testid="map-reduce-reduce-status">
                    {run.reduceStep.status}
                </span>
            </div>
            <ReduceStepActions
                reduceStep={run.reduceStep}
                busyAction={ctx.busyAction}
                onSelectChildProcess={ctx.onSelectChildProcess}
                onRetry={() => void ctx.runAction('retry-reduce', () => ctx.client.mapReduce.retryReduce(ctx.workspaceId, run.runId))}
            />
        </section>
    );
}

interface ReduceStepActionsProps {
    reduceStep: MapReduceReduceStep;
    busyAction: string | null;
    onSelectChildProcess?: (processId: string) => void;
    onRetry: () => void;
}

function ReduceStepActions({ reduceStep, busyAction, onSelectChildProcess, onRetry }: ReduceStepActionsProps) {
    const canRetry = reduceStep.status === 'failed';
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            {reduceStep.error && (
                <p className="basis-full text-[11px] text-red-600 dark:text-red-300" title={reduceStep.error}>
                    {reduceStep.error}
                </p>
            )}
            {reduceStep.childProcessId ? (
                <button
                    type="button"
                    onClick={() => onSelectChildProcess?.(reduceStep.childProcessId!)}
                    className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                    data-testid={reduceStep.status === 'completed' ? 'map-reduce-final-result-link' : 'map-reduce-reduce-child-link'}
                >
                    {reduceStep.status === 'completed' ? 'Open final result' : 'Open reduce chat'}
                </button>
            ) : (
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Reduce has not started.</span>
            )}
            <button
                type="button"
                onClick={onRetry}
                disabled={!canRetry || busyAction !== null}
                data-testid="map-reduce-retry-reduce"
                className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/40"
            >
                Retry reduce
            </button>
        </div>
    );
}
