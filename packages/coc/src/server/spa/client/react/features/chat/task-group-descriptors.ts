/**
 * task-group-descriptors — per-type presentation/behavior descriptors for
 * hierarchical task groups in the chat list.
 *
 * Adding a new hierarchical feature to the chat list means registering a
 * descriptor here (label, badge, accent, pin type, matching) instead of
 * duplicating grouping modules and row components.
 */

import { getTaskGroupIdForType } from './task-group-grouping';
import { getForEachRunId } from './for-each-run-grouping';
import { getMapReduceRunId } from './map-reduce-run-grouping';
import { getRalphSessionId } from './ralph-session-grouping';

export interface TaskGroupDescriptor {
    /** Registry group type ('for-each', 'map-reduce', 'ralph', 'dream', ...). */
    type: string;
    /** History-entry discriminator / DOM test-id prefix (e.g. 'for-each-run'). */
    entryKind: string;
    /** Workspace group-pin type. Legacy names are kept so persisted pins stay valid. */
    pinType: string;
    /** Display label for parent rows (e.g. 'For Each'). */
    label: string;
    /** Compact mono badge text (e.g. 'FE'). */
    badge: string;
    /** Tailwind accent family used for badges/summaries ('sky', 'indigo', 'purple'). */
    accent: string;
    /**
     * Whether this type renders as a collapsed parent group in the chat list.
     * Hidden/linkage-only types (Dreams) keep their current presentation.
     */
    groupable: boolean;
    /** Resolve the group ID a task belongs to (generic tag plus legacy feature context). */
    matchesTask(task: any): string | undefined;
}

export const TASK_GROUP_DESCRIPTORS: Record<string, TaskGroupDescriptor> = {
    'for-each': {
        type: 'for-each',
        entryKind: 'for-each-run',
        pinType: 'for-each-run',
        label: 'For Each',
        badge: 'FE',
        accent: 'sky',
        groupable: true,
        matchesTask: task => getForEachRunId(task),
    },
    'map-reduce': {
        type: 'map-reduce',
        entryKind: 'map-reduce-run',
        pinType: 'map-reduce-run',
        label: 'Map Reduce',
        badge: 'MR',
        accent: 'indigo',
        groupable: true,
        matchesTask: task => getMapReduceRunId(task),
    },
    ralph: {
        type: 'ralph',
        entryKind: 'ralph-session',
        pinType: 'ralph-session',
        label: 'Ralph',
        badge: 'RALPH',
        accent: 'purple',
        groupable: true,
        matchesTask: task => getRalphSessionId(task),
    },
    dream: {
        type: 'dream',
        entryKind: 'dream-run',
        pinType: 'dream',
        label: 'Dream',
        badge: 'DR',
        accent: 'violet',
        // Linkage-only: dream internals keep their current (ungrouped) chat-list presentation.
        groupable: false,
        matchesTask: task => getTaskGroupIdForType(task, 'dream'),
    },
};

export function getTaskGroupDescriptor(type: string): TaskGroupDescriptor | undefined {
    return TASK_GROUP_DESCRIPTORS[type];
}
