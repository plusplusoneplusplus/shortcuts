/**
 * Executor Registry — Classification Routing Tests
 *
 * Verifies that tasks carrying `context.classifyDiff` are routed to the
 * ClassificationExecutor instead of the default mode-based executors.
 */

import { describe, it, expect, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ExecutorRegistry } from '../../../src/server/executors/executor-registry';
import { ClassificationExecutor } from '../../../src/server/executors/classification-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
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

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

const sdkMocks = createMockSDKService();

function createRegistry() {
    const store = createMockProcessStore();
    const registry = new ExecutorRegistry(store, {
        approvePermissions: true,
        aiService: sdkMocks.service as any,
        dataDir: '/data',
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        toolCallCacheStore: { options: {} } as any,
        resolveSkillConfig: vi.fn().mockResolvedValue({}),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        onTitleNeeded: vi.fn(),
        getWsServer: () => undefined,
    });
    return { store, registry };
}

function makeClassifyTask(): QueuedTask {
    return {
        id: 'task-classify-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Classify PR #42',
            workspaceId: 'ws-1',
            context: {
                classifyDiff: {
                    repoId: 'repo-1',
                    prId: '42',
                    headSha: 'deadbeef',
                },
            },
        },
        config: {},
        displayName: 'Classify PR #42',
    } as unknown as QueuedTask;
}

describe('ExecutorRegistry — classification routing', () => {
    it('dispatches classifyDiff tasks to ClassificationExecutor', async () => {
        const { registry } = createRegistry();
        const task = makeClassifyTask();

        const classifySpy = vi.spyOn(ClassificationExecutor.prototype, 'execute').mockResolvedValue({
            response: 'classified',
            timeline: [],
        });
        const autopilotSpy = vi.spyOn(AutopilotExecutor.prototype, 'execute');

        await registry.dispatch(task, 'Classify PR #42');

        expect(classifySpy).toHaveBeenCalledOnce();
        expect(autopilotSpy).not.toHaveBeenCalled();
        classifySpy.mockRestore();
        autopilotSpy.mockRestore();
    });

    it('routing wins over autopilot mode', async () => {
        const { registry } = createRegistry();
        const task = makeClassifyTask();
        (task.payload as any).mode = 'autopilot';

        const classifySpy = vi.spyOn(ClassificationExecutor.prototype, 'execute').mockResolvedValue({
            response: 'classified',
            timeline: [],
        });

        await registry.dispatch(task, 'Classify');

        expect(classifySpy).toHaveBeenCalledOnce();
        classifySpy.mockRestore();
    });

    it('plain chat tasks (no classifyDiff) do NOT route to ClassificationExecutor', async () => {
        const { registry } = createRegistry();
        const task: QueuedTask = {
            id: 'task-plain-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hello',
            },
            config: {},
            displayName: 'Hello',
        } as unknown as QueuedTask;

        const classifySpy = vi.spyOn(ClassificationExecutor.prototype, 'execute');

        try {
            await registry.dispatch(task, 'Hello');
        } catch {
            /* expected — only checking routing */
        }

        expect(classifySpy).not.toHaveBeenCalled();
        classifySpy.mockRestore();
    });
});
