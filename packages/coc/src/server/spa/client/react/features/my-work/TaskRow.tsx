/**
 * Shared presentational bits for a single My Work task line.
 *
 * Every bucket on the Today tab renders the same row — checkbox, text, due
 * chip, tag pills, age badge, source link — so keyboard triage and inline edit
 * land here once rather than in each section.
 *
 * The metadata is parsed server-side off the markdown line, so nothing here
 * ever sees the raw `@due(...)` / `#tag` / `[↗](url)` syntax.
 */
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';
import { ageInDays, formatAge, formatDue } from './taskBuckets';

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

export interface TaskRowProps {
    task: MyWorkTask;
    /** `my-work-today-action` or `my-work-today-followup` — the row's testid stem. */
    testIdPrefix: string;
    onToggle: (task: MyWorkTask) => void;
}

/** One checkbox-backed task line, as an `<li>` for a caller-owned `<ul>`. */
export function TaskRow({ task, testIdPrefix, onToggle }: TaskRowProps) {
    return (
        <li className="flex items-start gap-1" data-testid={`${testIdPrefix}-${task.id}`}>
            <label className="flex-1 flex items-start gap-2 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    checked={task.checked}
                    onChange={() => onToggle(task)}
                    data-testid={`my-work-today-check-${task.id}`}
                />
                <span className={task.checked ? 'line-through text-gray-400' : ''}>
                    {task.text}
                </span>
                <DueChip task={task} />
                <TagPills task={task} />
                <AgeBadge task={task} />
            </label>
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
