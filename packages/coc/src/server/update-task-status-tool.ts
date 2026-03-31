/**
 * Update Task Status Tool
 *
 * Factory that creates an `update_task_status` custom tool for the Copilot SDK.
 * The model calls this tool to update the `status` field in a plan file's YAML
 * frontmatter (e.g., from "pending" to "in-progress" or "done").
 *
 * Follows the same per-invocation factory pattern as `suggest-follow-ups-tool.ts`
 * and `resolve-comment-tool.ts`.
 */

import { defineTool, updateTaskStatus, type TaskStatus, VALID_TASK_STATUSES } from '@plusplusoneplusplus/forge';

export interface UpdateTaskStatusArgs {
    filePath: string;
    status: TaskStatus;
}

/**
 * Create an `update_task_status` custom tool definition for the Copilot SDK.
 * Pass the returned `tool` in the `tools` array of SendMessageOptions.
 */
export function createUpdateTaskStatusTool() {
    const tool = defineTool<UpdateTaskStatusArgs>('update_task_status', {
        description:
            'Update the status field in the YAML frontmatter of a plan file. ' +
            'Valid statuses: pending | in-progress | done | future. ' +
            'Call this when you begin work (set in-progress) or finish (set done).',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the plan file whose status should be updated.',
                },
                status: {
                    type: 'string',
                    enum: VALID_TASK_STATUSES,
                    description: 'The new status to set in the plan frontmatter.',
                },
            },
            required: ['filePath', 'status'],
        },
        handler: async (args: UpdateTaskStatusArgs) => {
            await updateTaskStatus(args.filePath, args.status);
            return { updated: true, status: args.status, filePath: args.filePath };
        },
    });

    return { tool };
}
