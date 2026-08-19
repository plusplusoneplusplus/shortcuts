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
 * The list-level controls (the filter, `Clear completed`, both `Open note`
 * links) sit in the header rather than on a section, because any single bucket
 * can be empty — and an empty bucket renders nothing at all. Beside them the
 * header carries the triage chip: how much is overdue, due today, or stalled,
 * rather than a done-count that can only ever trend downward on a list that
 * never empties.
 *
 * Above the buckets sits the "What changed" strip, which reads a different
 * file (`notes/Work/timeline.md`) through its own endpoint and renders zero
 * pixels when that file is absent, empty or unreadable — see
 * `WhatChangedStrip`.
 *
 * Rows can be edited in place and snoozed (a `@due(...)` bump), so an item can
 * leave the list without being marked done — the notes are also what the
 * weekly summary is generated from, and a box ticked for something you did not
 * do writes a false "Completed" line into it.
 *
 * This component owns the state the keyboard layer drives (selection, which
 * editor and which menu is open, which sections are expanded) so that `j`/`k`
 * step through exactly the rows that are on screen and every shortcut lands on
 * the same handler its click does. See `useTaskKeyboardTriage`.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';
import { useVisualViewport } from '../../hooks/ui/useVisualViewport';
import { useMyWorkTasks } from './useMyWorkTasks';
import {
    bucketActionItems, filterTasks, formatTriageSummary, groupFollowUpsByAge,
    isoDaysFromNow, triageSummary,
} from './taskBuckets';
import type { TaskRowActions } from './TaskRow';
import { NeedsYouTodaySection } from './NeedsYouTodaySection';
import { WaitingOnSection } from './WaitingOnSection';
import { EverythingElseSection } from './EverythingElseSection';
import { TodayEmptyState, TodayNoMatches, TodaySkeleton } from './TodayPlaceholders';
import { useTaskKeyboardTriage } from './useTaskKeyboardTriage';
import { WhatChangedStrip } from './WhatChangedStrip';

export interface MyWorkTodayTabProps {
    /** Virtual workspace whose notes back the Today view (e.g. `my_work`). */
    workspaceId: string;
    /** True while this tab is the visible sub-tab; drives fetch and shortcuts. */
    active?: boolean;
}

export function MyWorkTodayTab({ workspaceId, active = true }: MyWorkTodayTabProps) {
    const {
        tasks, actionItems, followUps, firstLoad, isEmpty, error, busy,
        doneCount, load, toggle, editText, snooze, addActionItem, clearCompleted, sync,
    } = useMyWorkTasks(active);
    const [quickAdd, setQuickAdd] = useState('');
    const [filter, setFilter] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [snoozeMenuId, setSnoozeMenuId] = useState<string | null>(null);
    const [everythingElseExpanded, setEverythingElseExpanded] = useState(false);
    const [expandedPeople, setExpandedPeople] = useState<ReadonlySet<string>>(() => new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const filterRef = useRef<HTMLInputElement>(null);
    const quickAddRef = useRef<HTMLFormElement>(null);
    // The layout viewport does not shrink when the on-screen keyboard opens, so
    // `mt-auto` would park the quick-add form underneath it. Padding the scroll
    // container by the keyboard's height gives the form somewhere to scroll to.
    const keyboardHeight = useVisualViewport();

    const filterActive = filter.trim().length > 0;
    const visibleActionItems = useMemo(() => filterTasks(actionItems, filter), [actionItems, filter]);
    const visibleFollowUps = useMemo(() => filterTasks(followUps, filter), [followUps, filter]);

    const { needsYou, everythingElse } = useMemo(
        () => bucketActionItems(visibleActionItems, new Date()),
        [visibleActionItems],
    );
    const followUpGroups = useMemo(() => groupFollowUpsByAge(visibleFollowUps, new Date()), [visibleFollowUps]);
    // The chip reports the whole snapshot, not the filtered view: "2 overdue"
    // is a fact about your day, and having it change as you type in the filter
    // box would make it useless as a standing signal.
    const triage = useMemo(
        () => formatTriageSummary(triageSummary(actionItems, followUps, new Date())),
        [actionItems, followUps],
    );

    // Filtering is an explicit act of looking for something, so it expands the
    // disclosures rather than hiding matches behind them.
    const peopleExpanded = useMemo<ReadonlySet<string>>(
        () => (filterActive ? new Set(followUpGroups.map(g => g.person ?? '')) : expandedPeople),
        [filterActive, followUpGroups, expandedPeople],
    );
    const elseExpanded = filterActive || everythingElseExpanded;

    // Nav order for `j`/`k`: exactly the rows on screen, top to bottom. Rows
    // inside a collapsed disclosure are deliberately absent — stepping onto a
    // row nobody can see is the classic way a selection ring gets lost.
    const visibleRows = useMemo<MyWorkTask[]>(() => [
        ...needsYou,
        ...followUpGroups.flatMap(g => (peopleExpanded.has(g.person ?? '') ? g.items : [])),
        ...(elseExpanded ? everythingElse : []),
    ], [needsYou, followUpGroups, peopleExpanded, elseExpanded, everythingElse]);
    const order = useMemo(() => visibleRows.map(t => t.id), [visibleRows]);
    const findTask = useCallback((id: string) => visibleRows.find(t => t.id === id), [visibleRows]);

    useTaskKeyboardTriage({
        containerRef,
        enabled: active,
        order,
        selectedId,
        menuOpen: snoozeMenuId !== null,
        onSelect: setSelectedId,
        onToggle: id => { const t = findTask(id); if (t && !busy) toggle(t); },
        onEdit: id => { if (!busy) setEditingId(id); },
        onSetDue: setSnoozeMenuId,
        // `s` is the one-keystroke defer — "not today". Anything more specific
        // is what `d` and its picker are for.
        onSnooze: id => {
            const t = findTask(id);
            if (t && !busy) void snooze(t, isoDaysFromNow(new Date(), 1));
        },
        onFocusFilter: () => filterRef.current?.focus(),
        onEscape: () => {
            if (snoozeMenuId) setSnoozeMenuId(null);
            else setSelectedId(null);
        },
    });

    const rowActions: TaskRowActions = useMemo(() => ({
        onToggle: toggle,
        onEdit: (task, text) => { void editText(task, text); },
        onSnooze: (task, due) => { void snooze(task, due); },
        busy,
        selectedId,
        editingId,
        setEditingId,
        snoozeMenuId,
        setSnoozeMenuId,
        onSelect: setSelectedId,
    }), [toggle, editText, snooze, busy, selectedId, editingId, snoozeMenuId]);

    const togglePerson = useCallback((person: string) => {
        setExpandedPeople(prev => {
            const next = new Set(prev);
            if (!next.delete(person)) next.add(person);
            return next;
        });
    }, []);

    const submitQuickAdd = async () => {
        const text = quickAdd.trim();
        if (!text) return;
        if (await addActionItem(text)) setQuickAdd('');
    };

    const openNote = useCallback((path: string) => {
        location.hash = `#repos/${workspaceId}/notes/${encodeURIComponent(path)}`;
    }, [workspaceId]);

    const linkClass = 'text-xs text-blue-600 dark:text-blue-400 hover:underline';
    // A filter that matches nothing is not the same thing as an empty list, and
    // offering Sync for it would be answering a question nobody asked.
    const noMatches = !!tasks && filterActive
        && needsYou.length === 0 && followUpGroups.length === 0 && everythingElse.length === 0;

    return (
        <div
            ref={containerRef}
            className="flex flex-col h-full min-h-0 overflow-auto p-4 gap-4 text-gray-900 dark:text-gray-100"
            style={keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : undefined}
            data-testid="my-work-today-tab"
        >
            {/* One row from `md:` up. Below it the controls drop under the
                heading and the filter takes the full width, rather than fighting
                the title for the ~120px a `w-32` box wants. */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Today</h2>
                <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
                    {tasks && (
                        <input
                            ref={filterRef}
                            type="text"
                            className="text-xs w-full touch-target md:w-32 border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 bg-transparent"
                            placeholder="Filter… (/)"
                            aria-label="Filter items"
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            onKeyDown={e => {
                                // Escape leaves the box rather than clearing it:
                                // the shortcuts are suppressed while it has focus,
                                // so getting out is what you need first.
                                if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
                            }}
                            data-testid="my-work-today-filter"
                        />
                    )}
                    {/* Triage state, not progress: how much is actually on fire
                        right now. An all-clear snapshot renders no chip. */}
                    {triage.length > 0 && (
                        <span
                            className="text-xs text-gray-500 dark:text-gray-400"
                            data-testid="my-work-today-stat"
                        >
                            {triage.join(' · ')}
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

            {/* Pinned above the buckets: what changed overnight, before what you
                have to do about it. Renders nothing at all — not an empty box —
                when there is no timeline note, which is currently the norm. */}
            <WhatChangedStrip workspaceId={workspaceId} active={active} />

            {firstLoad && <TodaySkeleton />}

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
                <TodayEmptyState onSync={() => void sync()} onOpenNote={openNote} busy={busy} />
            )}

            {noMatches && <TodayNoMatches onClear={() => setFilter('')} />}

            {tasks && (
                <>
                    <NeedsYouTodaySection items={needsYou} actions={rowActions} />
                    <WaitingOnSection
                        groups={followUpGroups}
                        actions={rowActions}
                        expanded={peopleExpanded}
                        onToggleExpanded={togglePerson}
                        workspaceId={workspaceId}
                    />
                    <EverythingElseSection
                        items={everythingElse}
                        actions={rowActions}
                        expanded={elseExpanded}
                        onToggleExpanded={() => setEverythingElseExpanded(v => !v)}
                    />
                </>
            )}

            <form
                ref={quickAddRef}
                className="flex items-center gap-2 mt-auto"
                onSubmit={e => { e.preventDefault(); void submitQuickAdd(); }}
                data-testid="my-work-today-quickadd"
            >
                <input
                    type="text"
                    className="flex-1 min-w-0 touch-target text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent"
                    placeholder="Add an action item…"
                    value={quickAdd}
                    onChange={e => setQuickAdd(e.target.value)}
                    // Focusing the field is what opens the keyboard, so this is
                    // the moment the form has to be brought back into view.
                    onFocus={() => quickAddRef.current?.scrollIntoView?.({ block: 'nearest' })}
                    data-testid="my-work-today-quickadd-input"
                />
                <button
                    type="submit"
                    className="shrink-0 touch-target text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                    disabled={busy || quickAdd.trim().length === 0}
                    data-testid="my-work-today-quickadd-btn"
                >
                    Add
                </button>
            </form>
        </div>
    );
}
