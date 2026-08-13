/**
 * Shared presentational bits for a single My Work task line.
 *
 * Every bucket on the Today tab renders the same row — checkbox, text, due
 * chip, tag pills, age badge, source link, and the snooze/edit affordances —
 * so those land here once rather than in each section.
 *
 * The metadata is parsed server-side off the markdown line, so nothing here
 * ever sees the raw `@due(...)` / `#tag` / `[↗](url)` syntax; snooze sends an
 * ISO date and the server owns the token.
 */
import { useEffect, useRef, useState } from 'react';
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';
import { ageInDays, formatAge, formatDue, snoozeOptions } from './taskBuckets';

/**
 * Age badge for a synced item. Renders nothing for undated or recent items, so
 * it can be dropped beside any task line unconditionally.
 */
export function AgeBadge({ task }: { task: MyWorkTask }) {
    const label = formatAge(ageInDays(task.addedAt, new Date()));
    if (!label) return null;
    return (
        <span
            className="shrink-0 text-[10px] leading-4 px-1 rounded text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60"
            title={`Synced ${task.addedAt}`}
            data-testid={`my-work-today-age-${task.id}`}
        >
            {label}
        </span>
    );
}

/** Colour per urgency — overdue and today are the two that should catch the eye. */
const DUE_TONE_CLASS = {
    overdue: 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40',
    today: 'text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40',
    soon: 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40',
    later: 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60',
} as const;

/** Due-date chip. Renders nothing when the item has no `@due(...)`. */
export function DueChip({ task }: { task: MyWorkTask }) {
    const label = formatDue(task.due, new Date());
    if (!label) return null;
    return (
        <span
            className={`shrink-0 text-[10px] leading-4 px-1 rounded font-medium ${DUE_TONE_CLASS[label.tone]}`}
            title={`Due ${task.due}`}
            data-tone={label.tone}
            data-testid={`my-work-today-due-${task.id}`}
        >
            {label.text}
        </span>
    );
}

/** Topic tags as pills. Renders nothing when the item carries no `#tag`. */
export function TagPills({ task }: { task: MyWorkTask }) {
    if (!task.tags?.length) return null;
    return (
        <>
            {task.tags.map(tag => (
                <span
                    key={tag}
                    className="shrink-0 text-[10px] leading-4 px-1 rounded text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/40"
                    data-testid={`my-work-today-tag-${task.id}-${tag}`}
                >
                    #{tag}
                </span>
            ))}
        </>
    );
}

/**
 * Jump back to wherever the item came from — the mail, the Teams thread, the
 * doc. This is what turns a reminder into something you can act on without
 * going to hunt for the context first, so it gets a generous hit area rather
 * than the ~10px the glyph itself occupies.
 *
 * It sits outside the row's `<label>` on purpose: inside, a click would
 * activate the label and toggle the checkbox on the way to the link.
 */
export function SourceLink({ task }: { task: MyWorkTask }) {
    if (!task.sourceUrl) return null;
    return (
        <a
            href={task.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-2 py-0.5 -my-0.5 rounded text-sm leading-5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
            title={task.sourceUrl}
            aria-label="Open source"
            data-testid={`my-work-today-source-${task.id}`}
        >
            ↗
        </a>
    );
}

/**
 * The row-level callbacks and shared row state, bundled so each section
 * forwards one prop.
 *
 * Which row is selected, which one is being edited and which one has its due
 * menu open are held by the tab rather than by each row, because the keyboard
 * layer drives all three from outside: `e` has to be able to open an editor on
 * a row the mouse never touched. Clicks and keys then go through the same
 * setters, so the two input paths cannot disagree about what is open.
 */
export interface TaskRowActions {
    onToggle: (task: MyWorkTask) => void;
    /** Rewrite the item's display text. */
    onEdit: (task: MyWorkTask, text: string) => void;
    /** Bump the item's due date to an ISO `YYYY-MM-DD`. */
    onSnooze: (task: MyWorkTask, due: string) => void;
    /** True while a mutation is in flight — disables both row actions. */
    busy?: boolean;
    /** Id of the keyboard-selected row; drives the selection ring. */
    selectedId?: string | null;
    /** Id of the row whose inline editor is open, if any. */
    editingId?: string | null;
    setEditingId: (id: string | null) => void;
    /** Id of the row whose due menu is open, if any. */
    snoozeMenuId?: string | null;
    setSnoozeMenuId: (id: string | null) => void;
    /** Moves the keyboard selection — a click on a row also selects it. */
    onSelect?: (id: string) => void;
}

const ACTION_BTN_CLASS =
    'shrink-0 px-1.5 py-0.5 -my-0.5 rounded text-xs leading-5 text-gray-400 hover:text-gray-700 ' +
    'dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60 disabled:opacity-40';

/**
 * Push an item's due date out: tomorrow, next week, or a date you pick.
 *
 * This is the only way other than the checkbox for something to leave the
 * list, and that is the point — without it the honest options are permanent
 * clutter or ticking a box you did not earn, and the second one lies to the
 * weekly summary built from these same files.
 */
function SnoozeMenu({ task, onSnooze, busy, open, setOpen }: {
    task: MyWorkTask;
    onSnooze: (task: MyWorkTask, due: string) => void;
    busy?: boolean;
    open: boolean;
    setOpen: (open: boolean) => void;
}) {
    const options = snoozeOptions(new Date());
    const firstOptionRef = useRef<HTMLButtonElement>(null);

    // Opened by `d` there is nothing focused inside the menu, so neither the
    // arrow keys nor the blur-to-close below would have anything to work with.
    // Focusing the first option on open fixes both, and is harmless when the
    // menu was opened by a click.
    useEffect(() => { if (open) firstOptionRef.current?.focus(); }, [open]);

    const pick = (due: string) => {
        setOpen(false);
        onSnooze(task, due);
    };

    return (
        <div className="relative shrink-0">
            <button
                type="button"
                className={ACTION_BTN_CLASS}
                onClick={() => setOpen(!open)}
                disabled={busy}
                aria-expanded={open}
                aria-label="Snooze"
                title="Snooze"
                data-testid={`my-work-today-snooze-${task.id}`}
            >
                ⏰
            </button>
            {open && (
                // Closing on blur of the whole menu keeps a click on any option
                // inside it working, unlike a per-button blur handler.
                <div
                    className="absolute right-0 z-10 mt-1 flex flex-col gap-1 p-2 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg"
                    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
                    data-testid={`my-work-today-snooze-menu-${task.id}`}
                >
                    {options.map((option, i) => (
                        <button
                            key={option.key}
                            ref={i === 0 ? firstOptionRef : undefined}
                            type="button"
                            className="text-xs text-left whitespace-nowrap px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                            onClick={() => pick(option.due)}
                            data-testid={`my-work-today-snooze-${task.id}-${option.key}`}
                        >
                            {option.label}
                        </button>
                    ))}
                    <input
                        type="date"
                        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-transparent"
                        aria-label="Snooze until"
                        onChange={e => { if (e.target.value) pick(e.target.value); }}
                        data-testid={`my-work-today-snooze-${task.id}-date`}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Inline text editor for one row. Enter commits, Escape abandons — the two
 * keys anyone already expects — and the field starts selected so retyping the
 * item wholesale takes no extra click.
 */
function TaskTextEditor({ task, onEdit, onCancel }: {
    task: MyWorkTask;
    onEdit: (task: MyWorkTask, text: string) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(task.text);
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { inputRef.current?.select(); }, []);

    // Escape unmounts the input, and unmounting a focused input can fire blur —
    // which would save the very draft that was just abandoned. One settle per
    // editor, whichever exit runs first.
    const settled = useRef(false);
    const finish = (save: boolean) => {
        if (settled.current) return;
        settled.current = true;
        onCancel(); // leave edit mode either way; the list refetches on success
        if (save) onEdit(task, draft);
    };

    return (
        <input
            ref={inputRef}
            type="text"
            className="flex-1 text-sm border border-blue-400 rounded px-1 py-0.5 bg-transparent"
            value={draft}
            autoFocus
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            }}
            onBlur={() => finish(true)}
            aria-label="Edit item"
            data-testid={`my-work-today-edit-input-${task.id}`}
        />
    );
}

export interface TaskRowProps {
    task: MyWorkTask;
    /** `my-work-today-action` or `my-work-today-followup` — the row's testid stem. */
    testIdPrefix: string;
    actions: TaskRowActions;
}

/** One checkbox-backed task line, as an `<li>` for a caller-owned `<ul>`. */
export function TaskRow({ task, testIdPrefix, actions }: TaskRowProps) {
    const {
        onToggle, onEdit, onSnooze, busy,
        selectedId, editingId, setEditingId, snoozeMenuId, setSnoozeMenuId, onSelect,
    } = actions;
    const editing = editingId === task.id;
    const selected = selectedId === task.id;

    if (editing) {
        return (
            <li
                className="flex items-start gap-1"
                data-task-id={task.id}
                // The editor's own focus ring is the visible treatment here, but
                // the row is still the selected one and says so.
                data-selected={selected || undefined}
                data-testid={`${testIdPrefix}-${task.id}`}
            >
                <TaskTextEditor task={task} onEdit={onEdit} onCancel={() => setEditingId(null)} />
            </li>
        );
    }

    // The selection has to be visible to be usable — keyboard nav with no ring
    // is just invisible state. A ring rather than a background so it reads as
    // "focused" and does not collide with the checked/line-through styling.
    const selectionClass = selected
        ? 'ring-2 ring-blue-500 dark:ring-blue-400 rounded bg-blue-50/50 dark:bg-blue-900/20'
        : '';

    return (
        <li
            className={`flex items-start gap-1 group px-1 -mx-1 ${selectionClass}`}
            data-task-id={task.id}
            data-selected={selected || undefined}
            onMouseDown={() => onSelect?.(task.id)}
            data-testid={`${testIdPrefix}-${task.id}`}
        >
            <label className="flex-1 flex items-start gap-2 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    checked={task.checked}
                    onChange={() => onToggle(task)}
                    data-testid={`my-work-today-check-${task.id}`}
                />
                {/* Double-click is the shortcut; the pencil is the discoverable
                    path. `onDoubleClick` on the span alone would still toggle
                    the checkbox via the label, hence the preventDefault. */}
                <span
                    className={task.checked ? 'line-through text-gray-400' : ''}
                    onDoubleClick={e => { e.preventDefault(); if (!busy) setEditingId(task.id); }}
                >
                    {task.text}
                </span>
                <DueChip task={task} />
                <TagPills task={task} />
                <AgeBadge task={task} />
            </label>
            {/* Outside the `<label>`: inside, any click would toggle the box on
                the way through. */}
            <button
                type="button"
                className={ACTION_BTN_CLASS}
                onClick={() => setEditingId(task.id)}
                disabled={busy}
                aria-label="Edit item"
                title="Edit"
                data-testid={`my-work-today-edit-${task.id}`}
            >
                ✎
            </button>
            <SnoozeMenu
                task={task}
                onSnooze={onSnooze}
                busy={busy}
                open={snoozeMenuId === task.id}
                setOpen={open => setSnoozeMenuId(open ? task.id : null)}
            />
            <SourceLink task={task} />
        </li>
    );
}

/** The small uppercase heading each Today section shares. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {children}
        </h3>
    );
}
