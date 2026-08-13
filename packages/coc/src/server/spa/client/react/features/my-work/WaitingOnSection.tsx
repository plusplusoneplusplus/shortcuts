/**
 * "Waiting on others" — follow-ups rolled up per person, oldest first.
 *
 * Each person collapses to one line — `Priya · 3 items · oldest 9d` — because
 * the unit of action here is the person, not the item: you do not chase three
 * things separately, you send Priya one message. Age is the whole signal ("
 * waiting on Priya" says nothing, "Priya · 9d" says go nudge her), so it sits
 * on the summary line where it is readable without expanding anything.
 *
 * **Nudge** is the other half of that. These lists rot because acting on one
 * means composing a message from scratch, so the button hands a chat the items,
 * their ages and their source links and has it write the follow-up. It routes
 * through the existing floating-chat dialog — no new send mechanism, and
 * nothing leaves the machine until the user sends it. Outside a QueueProvider
 * (isolated renders, tests) it falls back to putting the draft on the
 * clipboard.
 *
 * Expansion state lives in the parent so the keyboard layer's nav order can
 * match what is actually on screen.
 *
 * Renders nothing when there are no follow-ups.
 */
import { useQueueOptional } from '../../contexts/QueueContext';
import { buildNudgeDraft, formatPersonSummary, type PersonGroup } from './taskBuckets';
import { SectionHeading, TaskRow, type TaskRowActions } from './TaskRow';

export interface WaitingOnSectionProps {
    groups: PersonGroup[];
    actions: TaskRowActions;
    /** Ids (`person` heading, or `''`) of the groups currently expanded. */
    expanded: ReadonlySet<string>;
    onToggleExpanded: (person: string) => void;
    /** Workspace the drafted nudge chat opens against. */
    workspaceId: string;
}

export function WaitingOnSection({ groups, actions, expanded, onToggleExpanded, workspaceId }: WaitingOnSectionProps) {
    const queue = useQueueOptional();
    if (groups.length === 0) return null;

    const nudge = (group: PersonGroup) => {
        const initialPrompt = buildNudgeDraft(group, new Date());
        if (queue) {
            queue.dispatch({
                type: 'OPEN_DIALOG',
                workspaceId,
                mode: 'ask',
                initialPrompt,
                launchMode: 'floating-chat',
            });
            return;
        }
        void navigator.clipboard?.writeText(initialPrompt);
    };

    return (
        <section data-testid="my-work-today-followups">
            <div className="mb-2">
                <SectionHeading>Waiting on others</SectionHeading>
            </div>
            {groups.map(group => {
                const key = group.person || '__none__';
                const isOpen = expanded.has(group.person ?? '');
                return (
                    <div
                        key={key}
                        className="mb-2"
                        data-testid={`my-work-today-person-${group.person || 'unassigned'}`}
                    >
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                                onClick={() => onToggleExpanded(group.person ?? '')}
                                aria-expanded={isOpen}
                                data-testid={`my-work-today-person-toggle-${group.person || 'unassigned'}`}
                            >
                                <span aria-hidden="true" className={isOpen ? '' : '-rotate-90'}>▾</span>
                                <span>{formatPersonSummary(group, new Date())}</span>
                            </button>
                            <button
                                type="button"
                                className="shrink-0 px-1.5 py-0.5 rounded text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                onClick={() => nudge(group)}
                                title={`Draft a follow-up to ${group.person || 'them'}`}
                                data-testid={`my-work-today-nudge-${group.person || 'unassigned'}`}
                            >
                                Nudge
                            </button>
                        </div>
                        {isOpen && (
                            <ul className="flex flex-col gap-1 mt-1">
                                {group.items.map(task => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        testIdPrefix="my-work-today-followup"
                                        actions={actions}
                                    />
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })}
        </section>
    );
}
