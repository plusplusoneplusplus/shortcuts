/**
 * ask_user answer routing — bridge ownership.
 *
 * Regression coverage for: with two workspaces active, a foreign repo's bridge
 * claimed an ask_user answer (the ProcessStore is shared, so it saw a matching
 * persisted `pendingAskUser` while its own live handles were absent), persisted
 * a durable answer, and enqueued a "server restarted" resume onto its own repo's
 * queue — surfacing the answer under the wrong chat while the genuinely waiting
 * turn hung.
 *
 * Two bridges over one shared in-memory store, plus the router's owner-addressed
 * dispatch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return { ...actual, existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync), mkdirSync: vi.fn() };
});

import { TaskQueueManager, RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import type { AIProcess, PendingAskUserQuestion } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { createMockProcessStore } from './helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, sdkServiceRegistry: { getOrThrow: () => sdkMocks.service } };
});

// Absolute, platform-correct roots so the ownership comparison is exercised the
// same way on Linux/macOS/Windows.
const OWNER_ROOT = path.resolve(path.sep, 'repos', 'owner');
const FOREIGN_ROOT = path.resolve(path.sep, 'repos', 'foreign');

function pendingQuestion(questionId: string): PendingAskUserQuestion {
    return {
        batchId: 'batch-1',
        questionId,
        question: `Question ${questionId}?`,
        type: 'text',
        turnIndex: 1,
        index: 0,
        batchSize: 1,
    };
}

function seedProcess(
    store: ReturnType<typeof createMockProcessStore>,
    overrides: Partial<AIProcess> & { id: string },
): void {
    void store.addProcess({
        type: 'chat',
        status: 'running',
        startTime: new Date(),
        promptPreview: 'test',
        fullPrompt: 'test',
        sdkSessionId: 'sess-1',
        metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-owner' },
        pendingAskUser: [pendingQuestion('q1')],
        ...overrides,
    } as AIProcess);
}

/** Attach a fake ask_user handle registry to a bridge (undefined = torn down). */
function withHandles(executor: CLITaskExecutor, resolve: boolean | undefined): { answerQuestions: any; answerQuestion: any; skipQuestion: any } | undefined {
    const handles = resolve === undefined ? undefined : {
        answerQuestion: vi.fn(() => true),
        skipQuestion: vi.fn(() => true),
        answerQuestions: vi.fn(() => resolve),
        cancelAll: vi.fn(),
        hasPending: vi.fn(() => true),
    };
    (executor as any).executors = { getAskUserHandles: vi.fn(() => handles) };
    return handles;
}

function makeBridge(
    store: ReturnType<typeof createMockProcessStore>,
    workingDirectory: string | undefined,
): { executor: CLITaskExecutor; qm: TaskQueueManager } {
    const qm = new TaskQueueManager();
    const executor = new CLITaskExecutor(store, {
        aiService: sdkMocks.service,
        workingDirectory,
        followUpSuggestions: { enabled: false, count: 3 },
    });
    executor.setQueueManager(qm);
    return { executor, qm };
}

describe('answerAskUserQuestions — bridge ownership', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
    });

    it('a foreign bridge refuses the batch: no durable write, no resume task', async () => {
        seedProcess(store, { id: 'proc-1', workingDirectory: OWNER_ROOT });
        const foreign = makeBridge(store, FOREIGN_ROOT);
        withHandles(foreign.executor, undefined); // no live handles — ambiguous on its own

        const ok = await foreign.executor.answerAskUserQuestions('proc-1', 'batch-1', [
            { questionId: 'q1', answer: 'postgres' },
        ]);

        expect(ok).toBe(false);
        const proc = store.processes.get('proc-1')!;
        expect(proc.pendingAskUserAnswer).toBeUndefined();
        expect(proc.pendingAskUser).toBeDefined(); // still waiting for the real owner
        expect(foreign.qm.getQueued()).toHaveLength(0);
    });

    it('the owner still takes the post-restart path: durable answer + resume on its own queue', async () => {
        seedProcess(store, { id: 'proc-2', workingDirectory: OWNER_ROOT });
        const owner = makeBridge(store, OWNER_ROOT);
        const foreign = makeBridge(store, FOREIGN_ROOT);
        withHandles(owner.executor, undefined); // true restart — handles torn down
        withHandles(foreign.executor, undefined);

        const ok = await owner.executor.answerAskUserQuestions('proc-2', 'batch-1', [
            { questionId: 'q1', answer: 'postgres' },
        ]);

        expect(ok).toBe(true);
        const proc = store.processes.get('proc-2')!;
        expect(proc.pendingAskUser).toBeUndefined();
        expect(proc.pendingAskUserAnswer?.batchId).toBe('batch-1');
        // resume runs on the owner's queue, not the foreign one
        expect(owner.qm.getQueued()).toHaveLength(1);
        expect(foreign.qm.getQueued()).toHaveLength(0);
    });

    it('the owner\'s live handles resolve the promise even when a foreign bridge is asked first', async () => {
        seedProcess(store, { id: 'proc-3', workingDirectory: OWNER_ROOT });
        const foreign = makeBridge(store, FOREIGN_ROOT);
        const owner = makeBridge(store, OWNER_ROOT);
        withHandles(foreign.executor, undefined);
        const ownerHandles = withHandles(owner.executor, true)!;

        // Insertion-order scan: foreign first.
        const foreignResult = await foreign.executor.answerAskUserQuestions('proc-3', 'batch-1', [
            { questionId: 'q1', answer: 'postgres' },
        ]);
        expect(foreignResult).toBe(false);

        const ownerResult = await owner.executor.answerAskUserQuestions('proc-3', 'batch-1', [
            { questionId: 'q1', answer: 'postgres' },
        ]);

        expect(ownerResult).toBe(true);
        expect(ownerHandles.answerQuestions).toHaveBeenCalled();
        const proc = store.processes.get('proc-3')!;
        expect(proc.pendingAskUser).toBeUndefined();
        expect(proc.pendingAskUserAnswer).toBeUndefined(); // live path — nothing durable
        expect(owner.qm.getQueued()).toHaveLength(0);
        expect(foreign.qm.getQueued()).toHaveLength(0);
    });

    it('a bridge with no configured workingDirectory still claims (single-bridge/CLI back-compat)', async () => {
        seedProcess(store, { id: 'proc-4', workingDirectory: OWNER_ROOT });
        const anyBridge = makeBridge(store, undefined);
        withHandles(anyBridge.executor, undefined);

        const ok = await anyBridge.executor.answerAskUserQuestions('proc-4', 'batch-1', [
            { questionId: 'q1', answer: 'a' },
        ]);

        expect(ok).toBe(true);
        expect(anyBridge.qm.getQueued()).toHaveLength(1);
    });

    it('a process with no recorded workingDirectory still claims (cannot be disproved)', async () => {
        seedProcess(store, { id: 'proc-5', workingDirectory: undefined });
        const bridge = makeBridge(store, FOREIGN_ROOT);
        withHandles(bridge.executor, undefined);

        const ok = await bridge.executor.answerAskUserQuestions('proc-5', 'batch-1', [
            { questionId: 'q1', answer: 'a' },
        ]);

        expect(ok).toBe(true);
    });

    it('a process running in a subdirectory of the bridge root is claimed', async () => {
        seedProcess(store, { id: 'proc-6', workingDirectory: path.join(OWNER_ROOT, 'packages', 'app') });
        const owner = makeBridge(store, OWNER_ROOT);
        withHandles(owner.executor, undefined);

        const ok = await owner.executor.answerAskUserQuestions('proc-6', 'batch-1', [
            { questionId: 'q1', answer: 'a' },
        ]);

        expect(ok).toBe(true);
        expect(owner.qm.getQueued()).toHaveLength(1);
    });

    it('a sibling directory sharing a name prefix is not treated as nested', async () => {
        seedProcess(store, { id: 'proc-7', workingDirectory: `${OWNER_ROOT}-extra` });
        const owner = makeBridge(store, OWNER_ROOT);
        withHandles(owner.executor, undefined);

        const ok = await owner.executor.answerAskUserQuestions('proc-7', 'batch-1', [
            { questionId: 'q1', answer: 'a' },
        ]);

        expect(ok).toBe(false);
    });

    it('single-question answer/skip also refuse on a foreign bridge', async () => {
        seedProcess(store, { id: 'proc-8', workingDirectory: OWNER_ROOT });
        const foreign = makeBridge(store, FOREIGN_ROOT);
        // Even with (implausible) live handles, a proven-foreign bridge disclaims.
        const handles = withHandles(foreign.executor, true)!;

        await expect(foreign.executor.answerAskUserQuestion('proc-8', 'q1', 'a')).resolves.toBe(false);
        await expect(foreign.executor.skipAskUserQuestion('proc-8', 'q1')).resolves.toBe(false);
        expect(handles.answerQuestion).not.toHaveBeenCalled();
        expect(handles.skipQuestion).not.toHaveBeenCalled();
    });
});

describe('MultiRepoQueueRouter — owner-addressed ask-user dispatch', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let router: MultiRepoQueueRouter;

    beforeEach(() => {
        sdkMocks.resetAll();
        store = createMockProcessStore();
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false });
    });

    it('calls only the owning bridge, whatever the insertion order', async () => {
        seedProcess(store, { id: 'proc-router', workingDirectory: OWNER_ROOT });
        const foreign = router.getOrCreateBridge(FOREIGN_ROOT); // inserted first
        const owner = router.getOrCreateBridge(OWNER_ROOT);

        const foreignSpy = vi.spyOn(foreign, 'answerAskUserQuestions').mockResolvedValue(true);
        const ownerSpy = vi.spyOn(owner, 'answerAskUserQuestions').mockResolvedValue(true);

        const answers = [{ questionId: 'q1', answer: 'postgres' }];
        await expect(router.answerAskUserQuestions('proc-router', 'batch-1', answers)).resolves.toBe(true);

        expect(ownerSpy).toHaveBeenCalledWith('proc-router', 'batch-1', answers);
        expect(foreignSpy).not.toHaveBeenCalled();

        router.dispose();
    });

    it('materializes the owning bridge when it does not exist yet (post-restart)', async () => {
        seedProcess(store, { id: 'proc-cold', workingDirectory: OWNER_ROOT });

        await router.answerAskUserQuestions('proc-cold', 'batch-1', [{ questionId: 'q1', answer: 'a' }]);

        expect(router.getAllBridges().has(path.resolve(OWNER_ROOT))).toBe(true);

        router.dispose();
    });

    it('resolves the root from metadata.workspaceId when workingDirectory is absent', async () => {
        await store.registerWorkspace({ id: 'ws-owner', rootPath: OWNER_ROOT, name: 'owner' } as any);
        seedProcess(store, { id: 'proc-ws', workingDirectory: undefined });
        const owner = router.getOrCreateBridge(OWNER_ROOT);
        const ownerSpy = vi.spyOn(owner, 'answerAskUserQuestion').mockResolvedValue(true);

        await expect(router.answerAskUserQuestion('proc-ws', 'q1', 'a')).resolves.toBe(true);
        expect(ownerSpy).toHaveBeenCalledWith('proc-ws', 'q1', 'a');

        router.dispose();
    });

    it('returns false (→ 404) when the owning root cannot be resolved', async () => {
        seedProcess(store, { id: 'proc-unknown', workingDirectory: undefined, metadata: { type: 'chat', provider: 'copilot' } as any });
        const foreign = router.getOrCreateBridge(FOREIGN_ROOT);
        const foreignSpy = vi.spyOn(foreign, 'answerAskUserQuestions').mockResolvedValue(true);

        await expect(router.answerAskUserQuestions('proc-unknown', 'batch-1', [{ questionId: 'q1', answer: 'a' }])).resolves.toBe(false);
        expect(foreignSpy).not.toHaveBeenCalled();

        await expect(router.answerAskUserQuestions('proc-missing', 'batch-1', [])).resolves.toBe(false);
        await expect(router.skipAskUserQuestion('proc-missing', 'q1')).resolves.toBe(false);

        router.dispose();
    });
});
