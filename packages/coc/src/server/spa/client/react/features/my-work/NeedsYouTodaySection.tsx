/**
 * "Needs you today" — the top bucket of the Today tab.
 *
 * Renders nothing when the bucket is empty, so an empty urgent list costs no
 * vertical space and leaves no stray header behind.
 */
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';
import { SectionHeading, TaskRow, type TaskRowActions } from './TaskRow';

export interface NeedsYouTodaySectionProps {
    items: MyWorkTask[];
    actions: TaskRowActions;
}

export function NeedsYouTodaySection({ items, actions }: NeedsYouTodaySectionProps) {
    if (items.length === 0) return null;
    return (
        <section data-testid="my-work-today-needs-you">
            <div className="mb-2">
                <SectionHeading>Needs you today</SectionHeading>
            </div>
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
        </section>
    );
}
