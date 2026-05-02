/**
 * Update Task Status Orchestration Tests (Mock-E2E)
 *
 * Exercises the `update_task_status` tool as it flows through AutopilotExecutor:
 * - Tool injection into `sendMessage` when `hasPlanFile` is true (files.length > 1)
 * - Tool NOT injected when `hasPlanFile` is false (files.length <= 1)
 * - Mock AI invokes the tool → real `updateTaskStatus` writes YAML frontmatter to disk
 * - All four valid statuses round-trip against a real temp file
 * - Error propagation when target file does not exist
 *
 * Uses the same mock setup as suggest-follow-ups-orchestration.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Mocks — same preamble as suggest-follow-ups-orchestration.test.ts
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return actual;
});

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function makeOptions(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ChatModeExecutorOptions>,
): ChatModeExecutorOptions {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        toolCallCacheStore: { options: {} } as any,
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        ...overrides,
    };
}

/** Build a task with `context.files` controlling `hasPlanFile`. */
function makeAutopilotTask(files?: string[], id = 'uts-task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Update the task status.',
            context: files ? { files } : undefined,
        },
        config: {},
        displayName: 'Update task status',
    };
}

/**
 * Parse YAML frontmatter `status` from file content.
 * Expects `---\nkey: value\n---\n` format.
 */
function parseFrontmatterStatus(content: string): string | undefined {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return undefined;
    const statusMatch = match[1].match(/^status:\s*(.+)$/m);
    return statusMatch ? statusMatch[1].trim() : undefined;
}

// ============================================================================
// Tests — tool injection
// ============================================================================

describe('update_task_status tool injection', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });
    });

    it('injects update_task_status tool when hasPlanFile is true (files.length > 1)', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', 'plan.md']);

        await executor.execute(task, 'Update the task status.');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeDefined();
        const updateTool = call.tools.find((t: any) => t.name === 'update_task_status');
        expect(updateTool).toBeDefined();
        expect(updateTool.name).toBe('update_task_status');
    });

    it('does NOT inject update_task_status tool when hasPlanFile is false (files.length <= 1)', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md']);

        await executor.execute(task, 'Update the task status.');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        // tools should be undefined (no follow-up tools either since disabled)
        expect(call.tools).toBeUndefined();
    });

    it('does NOT inject update_task_status tool when context.files is undefined', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(undefined);

        await executor.execute(task, 'Update the task status.');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeUndefined();
    });

    it('does NOT inject update_task_status tool when context is absent', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'uts-no-ctx',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'Hello' },
            config: {},
            displayName: 'No context',
        };

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeUndefined();
    });

    it('appends tool instruction suffix to the prompt when hasPlanFile is true', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', 'plan.md']);

        await executor.execute(task, 'Do work.');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('update_task_status');
    });
});

// ============================================================================
// Tests — real file I/O round-trip via update_task_status tool
// ============================================================================

describe('update_task_status real file I/O orchestration', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let tmpDir: string;
    let planFilePath: string;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });

        // Create a real temp directory and plan file with YAML frontmatter
        tmpDir = path.join(os.tmpdir(), `uts-test-${crypto.randomUUID()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        planFilePath = path.join(tmpDir, 'test.plan.md');
        fs.writeFileSync(planFilePath, '---\nstatus: pending\n---\n\n# Test Plan\n', 'utf-8');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('updates status to in-progress when mock AI invokes the tool', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: planFilePath, status: 'in-progress' });
            }
            return { success: true, response: 'Status updated.', sessionId: 'sess-io-1', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Begin work.');

        const content = fs.readFileSync(planFilePath, 'utf-8');
        expect(parseFrontmatterStatus(content)).toBe('in-progress');
    });

    it('updates status to done when mock AI invokes the tool', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: planFilePath, status: 'done' });
            }
            return { success: true, response: 'Done.', sessionId: 'sess-io-2', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Finish work.');

        const content = fs.readFileSync(planFilePath, 'utf-8');
        expect(parseFrontmatterStatus(content)).toBe('done');
    });

    it('updates status to future when mock AI invokes the tool', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: planFilePath, status: 'future' });
            }
            return { success: true, response: 'Set to future.', sessionId: 'sess-io-3', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Defer work.');

        const content = fs.readFileSync(planFilePath, 'utf-8');
        expect(parseFrontmatterStatus(content)).toBe('future');
    });

    it('updates status to pending (round-trip back to initial) when mock AI invokes the tool', async () => {
        // First change away from pending
        fs.writeFileSync(planFilePath, '---\nstatus: in-progress\n---\n\n# Test Plan\n', 'utf-8');

        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: planFilePath, status: 'pending' });
            }
            return { success: true, response: 'Reset to pending.', sessionId: 'sess-io-4', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Reset work.');

        const content = fs.readFileSync(planFilePath, 'utf-8');
        expect(parseFrontmatterStatus(content)).toBe('pending');
    });

    it('preserves file body content after status update', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: planFilePath, status: 'done' });
            }
            return { success: true, response: 'Done.', sessionId: 'sess-io-5', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Finish work.');

        const content = fs.readFileSync(planFilePath, 'utf-8');
        expect(content).toContain('# Test Plan');
    });

    it('returns tool result with updated: true from the handler', async () => {
        let toolResult: any;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                toolResult = await updateTool.handler({ filePath: planFilePath, status: 'done' });
            }
            return { success: true, response: 'Done.', sessionId: 'sess-io-6', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Finish.');

        expect(toolResult).toEqual({
            updated: true,
            status: 'done',
            filePath: planFilePath,
        });
    });
});

// ============================================================================
// Tests — error propagation
// ============================================================================

describe('update_task_status error propagation', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('throws when mock AI passes a nonexistent filePath', async () => {
        const nonexistentPath = path.join(os.tmpdir(), `nonexistent-${crypto.randomUUID()}`, 'missing.plan.md');

        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: nonexistentPath, status: 'done' });
            }
            return { success: true, response: 'Done.', sessionId: 'sess-err', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', 'plan.md']);

        await expect(executor.execute(task, 'Fail.')).rejects.toThrow();
    });
});

// ============================================================================
// Tests — no-frontmatter path
// ============================================================================

describe('update_task_status with no existing frontmatter', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let tmpDir: string;
    let planFilePath: string;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });

        tmpDir = path.join(os.tmpdir(), `uts-nofm-${crypto.randomUUID()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        planFilePath = path.join(tmpDir, 'bare.plan.md');
        // Write a file WITHOUT frontmatter
        fs.writeFileSync(planFilePath, '# Bare Plan\n\nSome content.\n', 'utf-8');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('prepends frontmatter when file has none', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            const updateTool = opts.tools?.find((t: any) => t.name === 'update_task_status');
            if (updateTool) {
                await updateTool.handler({ filePath: planFilePath, status: 'in-progress' });
            }
            return { success: true, response: 'Started.', sessionId: 'sess-nofm', toolCalls: [] };
        });

        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeAutopilotTask(['prompt.md', planFilePath]);

        await executor.execute(task, 'Start work.');

        const content = fs.readFileSync(planFilePath, 'utf-8');
        expect(parseFrontmatterStatus(content)).toBe('in-progress');
        expect(content).toContain('# Bare Plan');
        expect(content).toContain('Some content.');
    });
});
