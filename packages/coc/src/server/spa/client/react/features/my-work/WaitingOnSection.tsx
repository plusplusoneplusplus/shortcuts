/**
 * "Waiting on others" — follow-ups grouped by person, oldest first.
 *
 * Age is the whole signal here: "waiting on Priya" says nothing, "Priya · 9d"
 * says go nudge her. Groups and the items inside them are both ordered by age
 * descending; see `groupFollowUpsByAge`.
 *
 * Renders nothing when there are no follow-ups.
 */
import type { PersonGroup } from './taskBuckets';
import { SectionHeading, TaskRow, type TaskRowActions } from './TaskRow';

export interface WaitingOnSectionProps {
    groups: PersonGroup[];
    actions: TaskRowActions;
}

export function WaitingOnSection({ groups, actions }: WaitingOnSectionProps) {
    if (groups.length === 0) return null;
    return (
        <section data-testid="my-work-today-followups">
            <div className="mb-2">
                <SectionHeading>Waiting on others</SectionHeading>
            </div>
            {groups.map(group => (
                <div
                    key={group.person || '__none__'}
                    className="mb-2"
                    data-testid={`my-work-today-person-${group.person || 'unassigned'}`}
                >
                    {group.person && (
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{group.person}</div>
                    )}
                    <ul className="flex flex-col gap-1">
                        {group.items.map(task => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                testIdPrefix="my-work-today-followup"
                                actions={actions}
                            />
                        ))}
                    </ul>
                </div>
            ))}
        </section>
    );
}
