import type { RequestAdapter } from '../types';

/**
 * A single checkbox-backed task parsed from the My Work markdown files.
 *
 * Mirrors the server's `Task` in `my-work-tasks.ts`. The `id` is a
 * within-snapshot addressing token (a hash of the item's raw line + list), not
 * a durable primary key: editing an item's text or its inline metadata changes
 * its id, so the client refetches the list after any mutation that reflows
 * lines.
 */
export interface MyWorkTask {
    id: string;
    /** Display text — the inline `@due(…)` / `#tag` / `[↗](…)` syntax is stripped. */
    text: string;
    checked: boolean;
    /** Follow-ups only: the person heading the item is grouped under. */
    person?: string;
    /**
     * ISO date (`YYYY-MM-DD`) of the `## Synced <date>` heading the item was
     * appended under — its age. Absent for hand-added items.
     */
    addedAt?: string;
    /** ISO date (`YYYY-MM-DD`) parsed from an inline `@due(…)`. */
    due?: string;
    /** Inline `#tag` labels, without the leading `#`. */
    tags?: string[];
    /** URL parsed from an inline `[↗](url)` link back to the item's source. */
    sourceUrl?: string;
}

/** Both task lists parsed from `Action Items.md` and `Follow Ups.md`. */
export interface MyWorkTasks {
    actionItems: MyWorkTask[];
    followUps: MyWorkTask[];
}

/** Fields a PATCH may change on a single task line. */
export interface MyWorkTaskPatch {
    checked?: boolean;
    text?: string;
    /**
     * Set (`YYYY-MM-DD`) or clear (`null`) the item's due date — the snooze
     * path. Only the `@due(…)` token on the line changes; text, tags and the
     * source link are left as they are.
     */
    due?: string | null;
}

/**
 * One "what changed" line from the Work Radar timeline note.
 *
 * Mirrors the server's `TimelineEntry` in `my-work-timeline.ts`. Every field
 * but `id` and `text` is optional: the note is written by a sweep and
 * hand-edited, so the parser keeps whatever it can read off a line.
 */
export interface MyWorkTimelineEntry {
    id: string;
    /** ISO `YYYY-MM-DD` from the enclosing `## <date>` heading. */
    date?: string;
    /** `HH:MM` prefix on the bullet. */
    time?: string;
    /** Thread label from a leading `**[slug]**`. */
    thread?: string;
    /** The line's prose, with the time/thread/link syntax stripped. */
    text: string;
    /** Where the bullet points, already classified and safety-checked server-side. */
    link?: MyWorkTimelineLink;
}

/**
 * A timeline bullet's link target. Relative links resolve to a note inside the
 * My Work notes tree; anything that would escape the tree, or use a scheme
 * other than http(s), is dropped by the server and never reaches the client.
 */
export type MyWorkTimelineLink =
    | { kind: 'external'; url: string }
    | { kind: 'note'; path: string };

/** The timeline strip's payload: the newest few entries plus the full count. */
export interface MyWorkTimeline {
    entries: MyWorkTimelineEntry[];
    /** Total valid entries in the note — more than `entries.length` means "View all". */
    total: number;
    /** Notes-root-relative path of the note, for the "View all" link. */
    notePath: string;
}

/** Body for quick-adding a task to one of the lists. */
export interface AddMyWorkTaskInput {
    list: 'action' | 'followup';
    text: string;
    /** Required when `list === 'followup'`: the person heading to add under. */
    person?: string;
}

/**
 * Client for the My Work "Today view" task routes (`/api/my-work/tasks*`).
 *
 * These are single-server, unscoped routes (the My Work workspace is the only
 * source), so unlike most domains they take no `workspaceId`.
 */
export class MyWorkClient {
    constructor(private readonly transport: RequestAdapter) {}

    /** GET /api/my-work/tasks — parsed action items + follow-ups. */
    getTasks(): Promise<MyWorkTasks> {
        return this.transport.request<MyWorkTasks>('/my-work/tasks');
    }

    /**
     * GET /api/my-work/timeline — the newest "what changed" entries.
     *
     * Answers with an empty list when the note does not exist yet, which is
     * currently the normal case.
     */
    getTimeline(): Promise<MyWorkTimeline> {
        return this.transport.request<MyWorkTimeline>('/my-work/timeline');
    }

    /** PATCH /api/my-work/tasks/:id — toggle/edit a single checkbox line. */
    patchTask(id: string, patch: MyWorkTaskPatch): Promise<{ ok: true }> {
        return this.transport.request<{ ok: true }>(`/my-work/tasks/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: patch,
        });
    }

    /** POST /api/my-work/tasks — quick-add an item to a list. */
    addTask(input: AddMyWorkTaskInput): Promise<{ id: string }> {
        return this.transport.request<{ id: string }>('/my-work/tasks', {
            method: 'POST',
            body: input,
        });
    }

    /** POST /api/my-work/tasks/archive — move checked action items to Archive. */
    archiveTasks(): Promise<{ archived: number }> {
        return this.transport.request<{ archived: number }>('/my-work/tasks/archive', {
            method: 'POST',
        });
    }
}
