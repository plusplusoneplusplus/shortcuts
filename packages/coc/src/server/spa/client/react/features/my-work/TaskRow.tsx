/**
 * Shared presentational bits for a single My Work task line.
 *
 * Every bucket on the Today tab renders the same row — checkbox, text, age
 * badge — so keyboard triage and inline edit land here once rather than in
 * each section.
 */
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';
import { ageInDays, formatAge } from './taskBuckets';

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

export interface TaskRowProps {
    task: MyWorkTask;
    /** `my-work-today-action` or `my-work-today-followup` — the row's testid stem. */
    testIdPrefix: string;
    onToggle: (task: MyWorkTask) => void;
}

/** One checkbox-backed task line, as an `<li>` for a caller-owned `<ul>`. */
export function TaskRow({ task, testIdPrefix, onToggle }: TaskRowProps) {
    return (
        <li data-testid={`${testIdPrefix}-${task.id}`}>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    checked={task.checked}
                    onChange={() => onToggle(task)}
                    data-testid={`my-work-today-check-${task.id}`}
                />
                <span className={task.checked ? 'line-through text-gray-400' : ''}>
                    {task.text}
                </span>
                <AgeBadge task={task} />
            </label>
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
