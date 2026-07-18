import type { RequestAdapter } from '../types';

/**
 * A single checkbox-backed task parsed from the My Work markdown files.
 *
 * Mirrors the server's `Task` in `my-work-tasks.ts`. The `id` is a
 * within-snapshot addressing token (a hash of the item's text + list), not a
 * durable primary key: editing an item's text changes its id, so the client
 * refetches the list after any mutation that reflows lines.
 */
export interface MyWorkTask {
    id: string;
    text: string;
    checked: boolean;
    /** Follow-ups only: the person heading the item is grouped under. */
    person?: string;
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
