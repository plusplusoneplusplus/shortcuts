/**
 * MyWorkTodayTab — actionable "Today" view for a virtual workspace (My Work,
 * and later My Life via the `workspaceId` prop).
 *
 * Reads the task model exposed by the My Work task routes via
 * `useMyWorkTasks`, which parses `Action Items.md` and `Follow Ups.md` as the
 * single source of truth. The snapshot is then sorted into three urgency
 * buckets for display — Needs you today, Waiting on others, Everything else —
 * so the tab reads as a triage surface rather than an every-open-item backlog.
 *
 * Bucketing is purely a view concern (`taskBuckets.ts`): the notes keep their
 * on-disk order and users go on editing them by hand.
 *
 * The list-level controls (`Clear completed`, both `Open note` links) sit in
 * the header rather than on a section, because any single bucket can be empty
 * — and an empty bucket renders nothing at all.
 */
import { useMemo, useState } from 'react';
import { useMyWorkTasks } from './useMyWorkTasks';
import { bucketActionItems, groupFollowUpsByAge } from './taskBuckets';
import { NeedsYouTodaySection } from './NeedsYouTodaySection';
import { WaitingOnSection } from './WaitingOnSection';
import { EverythingElseSection } from './EverythingElseSection';

export interface MyWorkTodayTabProps {
    /** Virtual workspace whose notes back the Today view (e.g. `my_work`). */
    workspaceId: string;
    /** True while this tab is the visible sub-tab; drives the initial fetch. */
    active?: boolean;
}

export function MyWorkTodayTab({ workspaceId, active = true }: MyWorkTodayTabProps) {
    const {
        tasks, actionItems, followUps, firstLoad, isEmpty, error, busy,
        doneCount, totalCount, load, toggle, addActionItem, clearCompleted,
    } = useMyWorkTasks(active);
    const [quickAdd, setQuickAdd] = useState('');

    const { needsYou, everythingElse } = useMemo(
        () => bucketActionItems(actionItems, new Date()),
        [actionItems],
    );
    const followUpGroups = useMemo(() => groupFollowUpsByAge(followUps, new Date()), [followUps]);

    const submitQuickAdd = async () => {
        const text = quickAdd.trim();
        if (!text) return;
        if (await addActionItem(text)) setQuickAdd('');
    };

    const openNote = (path: string) => {
        location.hash = `#repos/${workspaceId}/notes/${encodeURIComponent(path)}`;
    };

    const linkClass = 'text-xs text-blue-600 dark:text-blue-400 hover:underline';

    return (
        <div className="flex flex-col h-full min-h-0 overflow-auto p-4 gap-4 text-gray-900 dark:text-gray-100" data-testid="my-work-today-tab">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Today</h2>
                <div className="flex items-center gap-3">
                    {totalCount > 0 && (
                        <span
                            className="text-xs text-gray-500 dark:text-gray-400"
                            data-testid="my-work-today-stat"
                        >
                            {doneCount}/{totalCount} done
                        </span>
                    )}
                    {tasks && doneCount >= 1 && (
                        <button
                            type="button"
                            className={`${linkClass} disabled:opacity-50`}
                            onClick={() => void clearCompleted()}
                            disabled={busy}
                            aria-busy={busy}
                            data-testid="my-work-today-clear-completed"
                        >
                            {busy ? 'Clearing…' : 'Clear completed'}
                        </button>
                    )}
                    {tasks && (
                        <>
                            <button
                                type="button"
                                className={linkClass}
                                onClick={() => openNote('Action Items.md')}
                                data-testid="my-work-today-open-actions"
                            >
                                Action Items
                            </button>
                            <button
                                type="button"
                                className={linkClass}
                                onClick={() => openNote('Follow Ups.md')}
                                data-testid="my-work-today-open-followups"
                            >
                                Follow Ups
                            </button>
                        </>
                    )}
                </div>
            </div>

            {firstLoad && (
                <div className="text-sm text-gray-500 dark:text-gray-400" data-testid="my-work-today-loading">
                    Loading tasks…
                </div>
            )}

            {error && (
                <div
                    className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
                    data-testid="my-work-today-error"
                >
                    <span>{error}</span>
                    <button
                        type="button"
                        className="underline"
                        onClick={() => void load()}
                        data-testid="my-work-today-retry"
                    >
                        Retry
                    </button>
                </div>
            )}

            {isEmpty && (
                <div className="text-sm text-gray-500 dark:text-gray-400" data-testid="my-work-today-empty">
                    Nothing for today. Add an action item below to get started.
                </div>
            )}

            {tasks && (
                <>
                    <NeedsYouTodaySection items={needsYou} onToggle={toggle} />
                    <WaitingOnSection groups={followUpGroups} onToggle={toggle} />
                    <EverythingElseSection items={everythingElse} onToggle={toggle} />
                </>
            )}

            <form
                className="flex items-center gap-2 mt-auto"
                onSubmit={e => { e.preventDefault(); void submitQuickAdd(); }}
                data-testid="my-work-today-quickadd"
            >
                <input
                    type="text"
                    className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent"
                    placeholder="Add an action item…"
                    value={quickAdd}
                    onChange={e => setQuickAdd(e.target.value)}
                    data-testid="my-work-today-quickadd-input"
                />
                <button
                    type="submit"
                    className="text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                    disabled={busy || quickAdd.trim().length === 0}
                    data-testid="my-work-today-quickadd-btn"
                >
                    Add
                </button>
            </form>
        </div>
    );
}
