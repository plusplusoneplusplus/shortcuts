/**
 * Work Item Task File Helpers
 *
 * Creates and updates a placeholder task file in the workspace tasks folder
 * when a work item execution starts. The file appears immediately in the Tasks
 * panel and its status is updated as the execution progresses.
 *
 * File location: <dataDir>/repos/<workspaceId>/tasks/work-items/<workItemId>.impl.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/** Status values written into the task file frontmatter. */
export type TaskFileStatus = 'in-progress' | 'done' | 'failed' | 'cancelled';

/**
 * Map a work item execution result status to a task file status string.
 */
export function toTaskFileStatus(executionStatus: 'completed' | 'failed' | 'cancelled'): TaskFileStatus {
    if (executionStatus === 'completed') return 'done';
    if (executionStatus === 'cancelled') return 'cancelled';
    return 'failed';
}

/**
 * Resolve the absolute path for a work item's placeholder task file.
 * The file lives at: <dataDir>/repos/<workspaceId>/tasks/work-items/<workItemId>.impl.md
 */
export function resolveWorkItemTaskFilePath(dataDir: string, workspaceId: string, workItemId: string): string {
    return path.join(dataDir, 'repos', workspaceId, 'tasks', 'work-items', `${workItemId}.impl.md`);
}

/**
 * Create or update the placeholder task file for a work item execution.
 *
 * The file uses markdown frontmatter (status field) so the Tasks panel can
 * reflect the live execution state. When status is 'in-progress' the file
 * appears with a running indicator; on completion it transitions to the
 * final status.
 *
 * @returns The absolute path to the created/updated file.
 */
export async function upsertWorkItemTaskFile(
    dataDir: string,
    workspaceId: string,
    workItemId: string,
    workItemTitle: string,
    status: TaskFileStatus,
): Promise<string> {
    const filePath = resolveWorkItemTaskFilePath(dataDir, workspaceId, workItemId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = `---\nstatus: ${status}\n---\n\n# ${workItemTitle}\n`;
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
}
