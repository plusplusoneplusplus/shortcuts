/**
 * Update Task Status Tool Tests
 *
 * Unit tests for the createUpdateTaskStatusTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock updateTaskStatus before importing the tool
const mockUpdateTaskStatus = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        updateTaskStatus: (...args: any[]) => mockUpdateTaskStatus(...args),
    };
});

import { createUpdateTaskStatusTool, type UpdateTaskStatusArgs } from '../../../src/server/llm-tools/update-task-status-tool';

describe('createUpdateTaskStatusTool', () => {
    beforeEach(() => {
        mockUpdateTaskStatus.mockReset();
        mockUpdateTaskStatus.mockResolvedValue(undefined);
    });

    it('returns an object with a tool property', () => {
        const result = createUpdateTaskStatusTool();
        expect(result).toHaveProperty('tool');
        expect(result.tool).toBeDefined();
    });

    it('tool has name "update_task_status"', () => {
        const { tool } = createUpdateTaskStatusTool();
        expect(tool.name).toBe('update_task_status');
    });

    it('has description, parameters, and handler properties', () => {
        const { tool } = createUpdateTaskStatusTool();
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('parameters match the expected JSON schema', () => {
        const { tool } = createUpdateTaskStatusTool();
        const params = tool.parameters as Record<string, unknown>;
        expect(params).toEqual({
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: expect.any(String),
                },
                status: {
                    type: 'string',
                    enum: ['pending', 'in-progress', 'done', 'future'],
                    description: expect.any(String),
                },
            },
            required: ['filePath', 'status'],
        });
    });

    it('handler calls updateTaskStatus with correct arguments', async () => {
        const { tool } = createUpdateTaskStatusTool();

        await tool.handler({ filePath: '/tmp/plan.md', status: 'in-progress' });

        expect(mockUpdateTaskStatus).toHaveBeenCalledOnce();
        expect(mockUpdateTaskStatus).toHaveBeenCalledWith('/tmp/plan.md', 'in-progress');
    });

    it('handler returns updated confirmation with status and filePath', async () => {
        const { tool } = createUpdateTaskStatusTool();

        const result = await tool.handler({ filePath: '/tmp/plan.md', status: 'done' });

        expect(result).toEqual({
            updated: true,
            status: 'done',
            filePath: '/tmp/plan.md',
        });
    });

    it('handler works with all valid statuses', async () => {
        const { tool } = createUpdateTaskStatusTool();

        for (const status of ['pending', 'in-progress', 'done', 'future'] as const) {
            mockUpdateTaskStatus.mockReset();
            mockUpdateTaskStatus.mockResolvedValue(undefined);

            const result = await tool.handler({ filePath: '/plans/task.md', status });

            expect(result).toEqual({
                updated: true,
                status,
                filePath: '/plans/task.md',
            });
            expect(mockUpdateTaskStatus).toHaveBeenCalledWith('/plans/task.md', status);
        }
    });

    it('handler propagates errors from updateTaskStatus', async () => {
        mockUpdateTaskStatus.mockRejectedValue(new Error('File not found'));

        const { tool } = createUpdateTaskStatusTool();

        await expect(
            tool.handler({ filePath: '/nonexistent.md', status: 'done' }),
        ).rejects.toThrow('File not found');
    });

    it('separate invocations produce independent tools', () => {
        const result1 = createUpdateTaskStatusTool();
        const result2 = createUpdateTaskStatusTool();

        expect(result1.tool).not.toBe(result2.tool);
        expect(result1.tool.name).toBe(result2.tool.name);
    });

    it('UpdateTaskStatusArgs type is importable', () => {
        // Compile-time check: if this file compiles, the type is importable
        const _check: UpdateTaskStatusArgs = { filePath: '/tmp/plan.md', status: 'pending' };
        expect(_check.filePath).toBe('/tmp/plan.md');
    });
});
