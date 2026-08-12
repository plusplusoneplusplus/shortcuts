/**
 * "Everything else" — the non-urgent remainder, collapsed behind a disclosure.
 *
 * The collapse is the point of the three-bucket layout: Today has to be
 * scannable in about five seconds, and anything that cannot survive that bar
 * belongs behind a triangle with a count on it.
 *
 * Renders nothing when the bucket is empty — no stray header, no empty toggle.
 */
import { useState } from 'react';
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';
import { TaskRow, type TaskRowActions } from './TaskRow';

export interface EverythingElseSectionProps {
    items: MyWorkTask[];
    actions: TaskRowActions;
}

export function EverythingElseSection({ items, actions }: EverythingElseSectionProps) {
    const [expanded, setExpanded] = useState(false);
    if (items.length === 0) return null;
    return (
        <section data-testid="my-work-today-everything-else">
            <button
                type="button"
                className="flex items-center gap-1 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                data-testid="my-work-today-everything-else-toggle"
            >
                <span aria-hidden="true" className={expanded ? '' : '-rotate-90'}>▾</span>
                <span>Everything else ({items.length})</span>
            </button>
            {expanded && (
                <ul className="flex flex-col gap-1">
                    {items.map(task => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            testIdPrefix="my-work-today-action"
                            actions={actions}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}
