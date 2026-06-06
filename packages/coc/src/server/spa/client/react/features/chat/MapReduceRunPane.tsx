import { useCallback, useEffect, useState } from 'react';
import type {
    MapReduceItem,
    MapReduceItemStatus,
    MapReduceReduceStep,
    MapReduceReduceStepStatus,
    MapReduceRun,
    MapReduceRunStatus,
} from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui/cn';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { formatRelativeTime } from '../../utils/format';

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

function singleLine(text: string, max = 120): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 3) + '...' : flat;
}

function countItems(run: MapReduceRun): string {
    const counts = new Map<MapReduceItemStatus, number>();
    for (const item of run.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([status, count]) => `${count} ${status}`).join(' - ');
}

function hasRunningItem(run: MapReduceRun): boolean {
    return run.items.some(item => item.status === 'running');
}

function hasFailedItem(run: MapReduceRun): boolean {
    return run.items.some(item => item.status === 'failed');
}

function hasPendingItem(run: MapReduceRun): boolean {
    return run.items.some(item => item.status === 'pending');
}

function canCancel(run: MapReduceRun): boolean {
    return run.status === 'draft' || run.status === 'approved' || run.status === 'running' || run.status === 'reducing' || run.status === 'failed';
}

function canStartOrContinue(run: MapReduceRun): boolean {
    if (run.status === 'approved') return true;
    if (run.status === 'running') {
        return !hasRunningItem(run) && !hasFailedItem(run) && hasPendingItem(run);
    }
    if (run.status === 'reducing') {
        return run.reduceStep.status === 'pending';
    }
    return false;
}

function promptPreview(item: MapReduceItem): string {
    return singleLine(item.prompt, 220);
}

export function MapReduceRunPane({ workspaceId, runId, onClose, onSelectGenerationProcess, onSelectChildProcess }: MapReduceRunPaneProps) {
    const [run, setRun] = useState<MapReduceRun | null | undefined>(undefined);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const nextRun = await getSpaCocClient().mapReduce.get(workspaceId, runId);
            setRun(nextRun);
            setError(null);
        } catch (err) {
            setRun(null);
            setError(getSpaCocClientErrorMessage(err, 'Failed to load Map Reduce run'));
        }
    }, [workspaceId, runId]);

    useEffect(() => {
        setRun(undefined);
        void refresh();
    }, [refresh]);

    async function runAction(actionId: string, action: () => Promise<MapReduceRun>) {
        setBusyAction(actionId);
        setError(null);
        try {
            const nextRun = await action();
            setRun(nextRun);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Map Reduce action failed'));
        } finally {
            setBusyAction(null);
        }
    }

    if (run === undefined) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400" data-testid="map-reduce-run-pane-loading">
                Loading Map Reduce run...
            </div>
        );
    }

    if (run === null) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400" data-testid="map-reduce-run-pane-empty">
                <p>Map Reduce run not found.</p>
                <p className="text-xs">Run id: <code className="font-mono">{runId}</code></p>
                {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
            </div>
        );
    }

    const startContinueEnabled = canStartOrContinue(run);
    const cancelEnabled = canCancel(run);
    const startOrContinue = () => {
        if (run.status === 'approved') {
            return getSpaCocClient().mapReduce.start(workspaceId, run.runId);
        }
        return getSpaCocClient().mapReduce.continue(workspaceId, run.runId);
    };
    const generationProcessId = run.generationProcessId;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-zinc-950" data-testid="map-reduce-run-pane">
            <div className="flex flex-wrap items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Map Reduce: {singleLine(run.originalRequest, 90)}
                        </h2>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', RUN_STATUS_CLASS[run.status])} data-testid="map-reduce-run-status">
                            {run.status}
                        </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        <span data-testid="map-reduce-run-counts">{countItems(run)}</span>
                        <span>Reduce: {run.reduceStep.status}</span>
                        <span>Max parallel: {run.maxParallel}</span>
                        <span>Child mode: {run.childMode === 'ask' ? 'Ask' : 'Autopilot'}</span>
                        <span>Updated {formatRelativeTime(run.updatedAt)}</span>
                        {run.provider && <span>Provider: {run.provider}</span>}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {generationProcessId && onSelectGenerationProcess && (
                        <button
                            type="button"
                            onClick={() => onSelectGenerationProcess(generationProcessId)}
                            data-testid="map-reduce-generation-link-btn"
                            className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100 dark:hover:bg-indigo-900/60"
                        >
                            Open generation chat
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => runAction('continue', startOrContinue)}
                        disabled={!startContinueEnabled || busyAction !== null}
                        data-testid="map-reduce-continue-btn"
                        className="rounded border border-indigo-500 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-100"
                    >
                        {run.status === 'approved' ? 'Start' : 'Continue'}
                    </button>
                    <button
                        type="button"
                        onClick={() => runAction('cancel', () => getSpaCocClient().mapReduce.cancel(workspaceId, run.runId))}
                        disabled={!cancelEnabled || busyAction !== null}
                        data-testid="map-reduce-cancel-btn"
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Cancel remaining
                    </button>
                    <button
                        type="button"
                        onClick={() => void refresh()}
                        disabled={busyAction !== null}
                        data-testid="map-reduce-refresh-btn"
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Refresh
                    </button>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            data-testid="map-reduce-close-btn"
                            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && (
                    <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="map-reduce-run-error">
                        {error}
                    </div>
                )}

                <section className="mb-3 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" data-testid="map-reduce-original-request">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Original request</h3>
                    <p className="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-200">{run.originalRequest}</p>
                </section>

                {run.sharedInstructions?.trim() && (
                    <section className="mb-3 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" data-testid="map-reduce-shared-instructions-preview">
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Shared instructions</h3>
                        <p className="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-200">{run.sharedInstructions}</p>
                    </section>
                )}

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
                        busyAction={busyAction}
                        onSelectChildProcess={onSelectChildProcess}
                        onRetry={() => runAction('retry-reduce', () => getSpaCocClient().mapReduce.retryReduce(workspaceId, run.runId))}
                    />
                </section>

                <div className="overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full table-fixed text-left text-xs" data-testid="map-reduce-items-table">
                        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                            <tr>
                                <th className="w-32 px-2 py-2">Status</th>
                                <th className="w-56 px-2 py-2">Map item</th>
                                <th className="px-2 py-2">Prompt preview</th>
                                <th className="w-44 px-2 py-2">Child chat</th>
                                <th className="w-40 px-2 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {run.items.map(item => (
                                <MapReduceItemRow
                                    key={item.id}
                                    item={item}
                                    busyAction={busyAction}
                                    onSelectChildProcess={onSelectChildProcess}
                                    onRetry={() => runAction(`retry:${item.id}`, () => getSpaCocClient().mapReduce.retryItem(workspaceId, run.runId, item.id))}
                                    onSkip={() => runAction(`skip:${item.id}`, () => getSpaCocClient().mapReduce.skipItem(workspaceId, run.runId, item.id))}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
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

interface MapReduceItemRowProps {
    item: MapReduceItem;
    busyAction: string | null;
    onSelectChildProcess?: (processId: string) => void;
    onRetry: () => void;
    onSkip: () => void;
}

function MapReduceItemRow({ item, busyAction, onSelectChildProcess, onRetry, onSkip }: MapReduceItemRowProps) {
    const canRetry = item.status === 'failed';
    const canSkip = item.status === 'failed' || item.status === 'pending';

    return (
        <tr data-testid={`map-reduce-item-${item.id}`} className="align-top text-zinc-800 dark:text-zinc-100">
            <td className="px-2 py-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', ITEM_STATUS_CLASS[item.status])}>
                    {item.status}
                </span>
                {item.error && (
                    <p className="mt-1 line-clamp-3 text-[11px] text-red-600 dark:text-red-300" title={item.error}>
                        {item.error}
                    </p>
                )}
            </td>
            <td className="px-2 py-2">
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{item.id}</div>
                {item.dependsOn && item.dependsOn.length > 0 && (
                    <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        Depends on {item.dependsOn.join(', ')}
                    </div>
                )}
            </td>
            <td className="px-2 py-2">
                <p className="line-clamp-4 text-zinc-700 dark:text-zinc-200" title={item.prompt} data-testid={`map-reduce-item-prompt-${item.id}`}>
                    {promptPreview(item)}
                </p>
            </td>
            <td className="px-2 py-2">
                {item.childProcessId ? (
                    <button
                        type="button"
                        onClick={() => onSelectChildProcess?.(item.childProcessId!)}
                        className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                        data-testid={`map-reduce-child-link-${item.id}`}
                    >
                        Open map chat
                    </button>
                ) : (
                    <span className="text-[11px] text-zinc-400">Not started</span>
                )}
            </td>
            <td className="px-2 py-2">
                <div className="flex flex-wrap gap-1">
                    <button
                        type="button"
                        onClick={onRetry}
                        disabled={!canRetry || busyAction !== null}
                        data-testid={`map-reduce-retry-${item.id}`}
                        className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/40"
                    >
                        Retry
                    </button>
                    <button
                        type="button"
                        onClick={onSkip}
                        disabled={!canSkip || busyAction !== null}
                        data-testid={`map-reduce-skip-${item.id}`}
                        className="rounded border border-amber-300 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
                    >
                        Skip
                    </button>
                </div>
            </td>
        </tr>
    );
}
