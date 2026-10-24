/**
 * Executor wiring for `sentinel_jobs`: only the owning Sentinel chat's attended turns receive the tool, bound to
 * that chat and workspace, with the turn's resolved settings as job defaults. Gate notices, PR outcome reviews,
 * automation turns, other modes and disabled features get nothing.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { FollowUpExecutor, type FollowUpTurnOptions } from '../../../src/server/executors/follow-up-executor';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import { SENTINEL_REFRAINS_TOOL_NAME } from '../../../src/server/llm-tools/sentinel-refrains-tool';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime, type FlatExecutorOptions } from '../executors/runtime-options-helper';

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: vi.fn().mockResolvedValue({
        tools: [], suffix: '', systemMessageSuffix: undefined, excludedBuiltinTools: [], dispose: vi.fn(),
    }),
}));

const sdkMocks = createMockSDKService();
let dataDir: string;

function makeCommands() {
    return {
        jobs: {
            assertOwner: vi.fn().mockResolvedValue(undefined),
            list: vi.fn().mockResolvedValue([]), get: vi.fn(), update: vi.fn(), start: vi.fn(), cancel: vi.fn(),
            create: vi.fn(async (_owner: unknown, input: Record<string, unknown>) => ({ id: 'job-1', ...input })),
        },
    };
}

function makeOptions(overrides?: FlatExecutorOptions) {
    return nestRuntime({
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        askUser: { enabled: true },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        resolveAiServiceForProvider: () => sdkMocks.service as any,
        ...overrides,
    }) as any;
}

function makeTask(mode: string, id: string, extra: Record<string, unknown> = {}, config: Record<string, unknown> = {}): QueuedTask {
    return {
        id, type: 'chat', priority: 'normal', status: 'running', createdAt: Date.now(),
        payload: { kind: 'chat', mode, prompt: 'Hello', workspaceId: 'ws-1', ...extra },
        config, displayName: 'Hello',
    } as QueuedTask;
}

function makeProcess(id: string, mode: string, workspaceId = 'ws-1'): AIProcess {
    return {
        id, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'hi',
        metadata: { type: 'chat', workspaceId, mode, provider: 'copilot' },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    } as AIProcess;
}

function lastCall(): any {
    return sdkMocks.mockSendMessage.mock.calls.at(-1)![0];
}

function jobsTool(call = lastCall()): any {
    return (call.tools ?? []).find((tool: any) => tool.name === SENTINEL_REFRAINS_TOOL_NAME);
}

async function followUp(commands: ReturnType<typeof makeCommands> | undefined, options?: FollowUpTurnOptions,
    processId = 'queue_parent', workspaceId = 'ws-1', mode = 'sentinel', turnSource?: { source: 'cron' | 'wakeup' | 'trigger' }) {
    const store = createMockProcessStore();
    await store.addProcess(makeProcess(processId, mode, workspaceId));
    writeRepoPreferences(dataDir, workspaceId, { disabledLlmTools: [] });
    await new FollowUpExecutor(store, makeOptions({ getSentinelRefrainCommands: () => commands as any }), dataDir)
        .executeFollowUp(processId, 'next', undefined, mode as any, undefined, undefined, undefined, undefined,
            turnSource, undefined, undefined, options);
    return lastCall();
}

describe('sentinel_jobs executor wiring', () => {
    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-jobs-exec-'));
        writeRepoPreferences(dataDir, 'ws-1', { disabledLlmTools: [] });
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it.each([
        { timeoutMs: 0, expected: 0 },
        { timeoutMs: 15_000, expected: 15_000 },
        { timeoutMs: undefined, expected: 30_000 },
    ])('preserves the first-turn task timeout $timeoutMs without replacing zero', async ({ timeoutMs, expected }) => {
        await new ChatExecutor(createMockProcessStore(), makeOptions(), dataDir)
            .execute(makeTask('ask', 'task-timeout', {}, { timeoutMs }), 'Hello');
        expect(lastCall().timeoutMs).toBe(expected);
    });

    it.each(['ask', 'autopilot'] as const)('keeps %s Refrain follow-ups unlimited despite finite defaults', async mode => {
        const call = await followUp(undefined, { sentinelScheduledJob: true }, 'queue_job', 'ws-2', mode);
        expect(call.timeoutMs).toBe(0);
        expect(call.idleTimeoutMs).toBe(0);
    });

    it('binds a sentinel first turn to its own chat and inherits the resolved settings', async () => {
        const commands = makeCommands();
        const executor = new ChatExecutor(createMockProcessStore(),
            makeOptions({ getSentinelRefrainCommands: () => commands as any }), dataDir);
        await executor.execute(makeTask('sentinel', 'task-s1', { provider: 'claude' }, { model: 'claude-sonnet-4.5' }), 'Hello');

        const tool = jobsTool();
        expect(tool).toBeDefined();
        await tool.handler({ action: 'list', workspaceId: 'ws-other', processId: 'queue_forged' }, {});
        expect(commands.jobs.list).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId: 'queue_task-s1' });

        const created = await tool.handler({ action: 'create', kind: 'custom', name: 'Nightly', instructions: 'Check' }, {});
        expect(created.error).toBeUndefined();
        expect(commands.jobs.create).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId: 'queue_task-s1' },
            expect.objectContaining({ provider: 'claude', model: 'claude-sonnet-4.5', enabled: false }));
    });

    it('stays absent under default preferences, for other modes, and while the feature is off', async () => {
        writeRepoPreferences(dataDir, 'ws-1', {});
        await new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelRefrainCommands: () => makeCommands() as any }), dataDir)
            .execute(makeTask('sentinel', 'task-default'), 'Hello');
        expect(jobsTool()).toBeUndefined();

        writeRepoPreferences(dataDir, 'ws-1', { disabledLlmTools: [] });
        for (const mode of ['ask', 'autopilot']) {
            await new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelRefrainCommands: () => makeCommands() as any }), dataDir)
                .execute(makeTask(mode, `task-${mode}`), 'Hello');
            expect(jobsTool()).toBeUndefined();
        }
        await new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelRefrainCommands: () => undefined }), dataDir)
            .execute(makeTask('sentinel', 'task-off'), 'Hello');
        expect(jobsTool()).toBeUndefined();
    });

    it('withholds the tool from automation-started sentinel first turns', async () => {
        await new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelRefrainCommands: () => makeCommands() as any }), dataDir)
            .execute(makeTask('sentinel', 'task-cron', { context: { source: 'cron', cronId: 'c1' } }), 'Hello');
        expect(jobsTool()).toBeUndefined();
    });

    it('offers attended sentinel follow-ups, isolated per chat and workspace', async () => {
        const first = makeCommands();
        await jobsTool(await followUp(first, undefined, 'queue_a', 'ws-1')).handler({ action: 'list' }, {});
        const second = makeCommands();
        await jobsTool(await followUp(second, undefined, 'queue_b', 'ws-2')).handler({ action: 'list' }, {});
        expect(first.jobs.list).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId: 'queue_a' });
        expect(second.jobs.list).toHaveBeenCalledWith({ workspaceId: 'ws-2', processId: 'queue_b' });
    });

    it.each<[string, FollowUpTurnOptions]>([
        ['refrain gate notices', { sentinelJobNotice: true }],
        ['PR outcome reviews', { sentinelPrOutcomeReview: true }],
        ['read-only turns', { readonly: true }],
    ])('withholds the tool from %s', async (_label, options) => {
        expect(jobsTool(await followUp(makeCommands(), options))).toBeUndefined();
    });

    it('withholds the tool from non-sentinel follow-ups and while the feature is off', async () => {
        expect(jobsTool(await followUp(makeCommands(), undefined, 'proc-ask', 'ws-1', 'ask'))).toBeUndefined();
        expect(jobsTool(await followUp(undefined))).toBeUndefined();
    });

    it.each(['cron', 'wakeup', 'trigger'] as const)('withholds the tool from %s-started follow-ups', async source => {
        expect(jobsTool(await followUp(makeCommands(), undefined, 'queue_parent', 'ws-1', 'sentinel', { source }))).toBeUndefined();
    });

    it.each([['notice', { sentinelJobNotice: true }],
        ['run', { sentinelScheduledJob: true }]] as const)(
        'marks scheduled-job %s follow-ups for the executor', async (kind, expected) => {
            const store = createMockProcessStore();
            await store.addProcess(makeProcess('queue_parent', 'sentinel'));
            const executeFollowUpFn = vi.fn(async () => undefined);
            const result = await new ProcessLifecycleRunner(store, undefined, () => undefined, 'copilot',
                { getSentinelRefrains: () => ({ guard: async () => undefined }) as any }).run({
                id: `task-${kind}`, type: 'chat', priority: 'low', status: 'running', createdAt: Date.now(), processId: 'queue_parent',
                payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'ws-1', processId: 'queue_parent', prompt: 'result',
                    context: { sentinelScheduledJob: { workspaceId: 'ws-1', processId: 'queue_parent', jobId: 'j1', runId: 'r1', kind } } },
                config: {}, displayName: kind,
            } as unknown as QueuedTask, {
                cancelledTasks: new Set(), executeFollowUpFn,
                executeByTypeFn: async () => ({ response: 'done.' }), getWorkingDirectoryFn: () => undefined,
            } as any);
            expect(result.error?.message).toBeUndefined();
            const options = (executeFollowUpFn.mock.calls[0] as unknown[]).at(-1) as Record<string, unknown>;
            expect(options).toMatchObject(expected);
            expect(options[kind === 'run' ? 'sentinelJobNotice' : 'sentinelScheduledJob']).toBeUndefined();
        });
});
