import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { cn } from '../../ui/cn';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { formatRelativeTime } from '../../utils/format';

/**
 * TaskGroupRunPane — shared run-detail pane for item-based task groups
 * (For Each runs, Map Reduce runs, future group types).
 *
 * All load/refresh/action state, the header with run metadata and actions,
 * the original-request / shared-instructions sections, and the items table
 * live here once. Feature panes stay as thin wrappers that supply a
 * {@link TaskGroupRunPaneConfig} (labels, accent classes, API adapter,
 * action enablement, and kind-specific extras such as the reduce step).
 */

export interface TaskGroupRunPaneItem {
    id: string;
    title: string;
    prompt: string;
    status: string;
    error?: string;
    dependsOn?: string[];
    childProcessId?: string;
}

export interface TaskGroupRunPaneRun {
    runId: string;
    status: string;
    originalRequest: string;
    sharedInstructions?: string;
    childMode: string;
    updatedAt: string;
    provider?: string;
    generationProcessId?: string;
    items: TaskGroupRunPaneItem[];
}

export type TaskGroupRunPaneClient = ReturnType<typeof useCocClient>;

export interface TaskGroupRunPaneActionContext {
    client: TaskGroupRunPaneClient;
    workspaceId: string;
    busyAction: string | null;
    /** Run a named exclusive action; the resolved run replaces the pane state. */
    runAction: (actionId: string, action: () => Promise<any>) => Promise<void>;
    onSelectChildProcess?: (processId: string) => void;
}

export interface TaskGroupRunPaneConfig<TRun extends TaskGroupRunPaneRun> {
    /** DOM test-id prefix (e.g. 'for-each' → 'for-each-run-pane', 'for-each-item-…'). */
    testIdPrefix: string;
    /** Display label used in the title, loading/empty states, and error fallbacks (e.g. 'For Each'). */
    label: string;
    /** Items-table column header for the item cell ('Item' | 'Map item'). */
    itemColumnHeader: string;
    /** Child chat link label ('Open child chat' | 'Open map chat'). */
    childChatLabel: string;
    /** Accent classes for the generation-chat link button. */
    generationButtonClassName: string;
    /** Accent classes for the Start/Continue button. */
    primaryButtonClassName: string;
    /** Accent classes for per-item child chat links. */
    childLinkClassName: string;
    /** Badge classes for the run's current status. */
    runStatusClassName: (status: TRun['status']) => string;
    /** Badge classes for an item's current status. */
    itemStatusClassName: (status: string) => string;
    canCancel: (run: TRun) => boolean;
    canStartOrContinue: (run: TRun) => boolean;
    api: {
        get: (client: TaskGroupRunPaneClient, workspaceId: string, runId: string) => Promise<TRun>;
        start: (client: TaskGroupRunPaneClient, workspaceId: string, runId: string) => Promise<TRun>;
        continue: (client: TaskGroupRunPaneClient, workspaceId: string, runId: string) => Promise<TRun>;
        cancel: (client: TaskGroupRunPaneClient, workspaceId: string, runId: string) => Promise<TRun>;
        retryItem: (client: TaskGroupRunPaneClient, workspaceId: string, runId: string, itemId: string) => Promise<TRun>;
        skipItem: (client: TaskGroupRunPaneClient, workspaceId: string, runId: string, itemId: string) => Promise<TRun>;
    };
    /** Extra header metadata spans rendered right after the item counts (e.g. reduce status). */
    renderHeaderMeta?: (run: TRun) => React.ReactNode;
    /** Extra sections rendered between shared instructions and the items table (e.g. reduce step). */
    renderExtraSections?: (run: TRun, ctx: TaskGroupRunPaneActionContext) => React.ReactNode;
}

export interface TaskGroupRunPaneProps<TRun extends TaskGroupRunPaneRun> {
    workspaceId: string;
    runId: string;
    config: TaskGroupRunPaneConfig<TRun>;
    onClose?: () => void;
    onSelectGenerationProcess?: (processId: string) => void;
    onSelectChildProcess?: (processId: string) => void;
}

function singleLine(text: string, max = 120): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 3) + '...' : flat;
}

function countItems(run: TaskGroupRunPaneRun): string {
    const counts = new Map<string, number>();
    for (const item of run.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([status, count]) => `${count} ${status}`).join(' - ');
}

export function TaskGroupRunPane<TRun extends TaskGroupRunPaneRun>({
    workspaceId,
    runId,
    config,
    onClose,
    onSelectGenerationProcess,
    onSelectChildProcess,
}: TaskGroupRunPaneProps<TRun>) {
    // AC-07: run data + actions target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const [run, setRun] = useState<TRun | null | undefined>(undefined);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const prefix = config.testIdPrefix;

    const refresh = useCallback(async () => {
        try {
            const nextRun = await config.api.get(cloneClient, workspaceId, runId);
            setRun(nextRun);
            setError(null);
        } catch (err) {
            setRun(null);
            setError(getSpaCocClientErrorMessage(err, `Failed to load ${config.label} run`));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId, runId, cloneClient]);

    useEffect(() => {
        setRun(undefined);
        void refresh();
    }, [refresh]);

    async function runAction(actionId: string, action: () => Promise<TRun>) {
        setBusyAction(actionId);
        setError(null);
        try {
            const nextRun = await action();
            setRun(nextRun);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, `${config.label} action failed`));
        } finally {
            setBusyAction(null);
        }
    }

    if (run === undefined) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400" data-testid={`${prefix}-run-pane-loading`}>
                Loading {config.label} run...
            </div>
        );
    }

    if (run === null) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400" data-testid={`${prefix}-run-pane-empty`}>
                <p>{config.label} run not found.</p>
                <p className="text-xs">Run id: <code className="font-mono">{runId}</code></p>
                {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
            </div>
        );
    }

    const startContinueEnabled = config.canStartOrContinue(run);
    const cancelEnabled = config.canCancel(run);
    const startOrContinue = () => {
        if (run.status === 'approved') {
            return config.api.start(cloneClient, workspaceId, run.runId);
        }
        return config.api.continue(cloneClient, workspaceId, run.runId);
    };
    const generationProcessId = run.generationProcessId;
    const actionContext: TaskGroupRunPaneActionContext = { client: cloneClient, workspaceId, busyAction, runAction, onSelectChildProcess };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-zinc-950" data-testid={`${prefix}-run-pane`}>
            <div className="flex flex-wrap items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {config.label}: {singleLine(run.originalRequest, 90)}
                        </h2>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', config.runStatusClassName(run.status))} data-testid={`${prefix}-run-status`}>
                            {run.status}
                        </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        <span data-testid={`${prefix}-run-counts`}>{countItems(run)}</span>
                        {config.renderHeaderMeta?.(run)}
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
                            data-testid={`${prefix}-generation-link-btn`}
                            className={cn('rounded border bg-white px-2 py-1 text-xs font-medium', config.generationButtonClassName)}
                        >
                            Open generation chat
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => runAction('continue', startOrContinue)}
                        disabled={!startContinueEnabled || busyAction !== null}
                        data-testid={`${prefix}-continue-btn`}
                        className={cn('rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50', config.primaryButtonClassName)}
                    >
                        {run.status === 'approved' ? 'Start' : 'Continue'}
                    </button>
                    <button
                        type="button"
                        onClick={() => runAction('cancel', () => config.api.cancel(cloneClient, workspaceId, run.runId))}
                        disabled={!cancelEnabled || busyAction !== null}
                        data-testid={`${prefix}-cancel-btn`}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Cancel remaining
                    </button>
                    <button
                        type="button"
                        onClick={() => void refresh()}
                        disabled={busyAction !== null}
                        data-testid={`${prefix}-refresh-btn`}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Refresh
                    </button>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            data-testid={`${prefix}-close-btn`}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && (
                    <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid={`${prefix}-run-error`}>
                        {error}
                    </div>
                )}

                <section className="mb-3 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" data-testid={`${prefix}-original-request`}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Original request</h3>
                    <p className="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-200">{run.originalRequest}</p>
                </section>

                {run.sharedInstructions?.trim() && (
                    <section className="mb-3 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" data-testid={`${prefix}-shared-instructions-preview`}>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Shared instructions</h3>
                        <p className="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-200">{run.sharedInstructions}</p>
                    </section>
                )}

                {config.renderExtraSections?.(run, actionContext)}

                <div className="overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full table-fixed text-left text-xs" data-testid={`${prefix}-items-table`}>
                        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                            <tr>
                                <th className="w-32 px-2 py-2">Status</th>
                                <th className="w-56 px-2 py-2">{config.itemColumnHeader}</th>
                                <th className="px-2 py-2">Prompt preview</th>
                                <th className="w-44 px-2 py-2">Child chat</th>
                                <th className="w-40 px-2 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {run.items.map(item => (
                                <TaskGroupRunItemRow
                                    key={item.id}
                                    item={item}
                                    config={config}
                                    busyAction={busyAction}
                                    onSelectChildProcess={onSelectChildProcess}
                                    onRetry={() => runAction(`retry:${item.id}`, () => config.api.retryItem(cloneClient, workspaceId, run.runId, item.id))}
                                    onSkip={() => runAction(`skip:${item.id}`, () => config.api.skipItem(cloneClient, workspaceId, run.runId, item.id))}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

interface TaskGroupRunItemRowProps<TRun extends TaskGroupRunPaneRun> {
    item: TaskGroupRunPaneItem;
    config: TaskGroupRunPaneConfig<TRun>;
    busyAction: string | null;
    onSelectChildProcess?: (processId: string) => void;
    onRetry: () => void;
    onSkip: () => void;
}

function TaskGroupRunItemRow<TRun extends TaskGroupRunPaneRun>({ item, config, busyAction, onSelectChildProcess, onRetry, onSkip }: TaskGroupRunItemRowProps<TRun>) {
    const prefix = config.testIdPrefix;
    const canRetry = item.status === 'failed';
    const canSkip = item.status === 'failed' || item.status === 'pending';

    return (
        <tr data-testid={`${prefix}-item-${item.id}`} className="align-top text-zinc-800 dark:text-zinc-100">
            <td className="px-2 py-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', config.itemStatusClassName(item.status))}>
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
                <p className="line-clamp-4 text-zinc-700 dark:text-zinc-200" title={item.prompt} data-testid={`${prefix}-item-prompt-${item.id}`}>
                    {singleLine(item.prompt, 220)}
                </p>
            </td>
            <td className="px-2 py-2">
                {item.childProcessId ? (
                    <button
                        type="button"
                        onClick={() => onSelectChildProcess?.(item.childProcessId!)}
                        className={cn('rounded border px-2 py-1 text-[11px]', config.childLinkClassName)}
                        data-testid={`${prefix}-child-link-${item.id}`}
                    >
                        {config.childChatLabel}
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
                        data-testid={`${prefix}-retry-${item.id}`}
                        className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/40"
                    >
                        Retry
                    </button>
                    <button
                        type="button"
                        onClick={onSkip}
                        disabled={!canSkip || busyAction !== null}
                        data-testid={`${prefix}-skip-${item.id}`}
                        className="rounded border border-amber-300 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
                    >
                        Skip
                    </button>
                </div>
            </td>
        </tr>
    );
}
