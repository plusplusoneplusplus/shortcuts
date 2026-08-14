import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { APIError } from '../../../src/server/errors';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import { parseWorkItemAiSettings } from '../../../src/server/work-items/work-item-execution-settings';
import type { WorkItemExecutionCommandContext } from '../../../src/server/work-items/work-item-execution-shared';
import {
    findLatestImplementationExecution,
    startWorkItemAiReviewCommand,
} from '../../../src/server/work-items/work-item-ai-review-command';

const REPO_ID = 'ai-review-repo';
const WORK_ITEM_ID = 'wi-ai-review';

let tmpDir: string;
let store: FileWorkItemStore;
let enqueue: ReturnType<typeof vi.fn>;
let enqueued: any;
let ctx: WorkItemExecutionCommandContext;

async function addReviewItem(overrides: Partial<WorkItem> = {}): Promise<void> {
    const now = new Date().toISOString();
    await store.addWorkItem({
        id: WORK_ITEM_ID,
        repoId: REPO_ID,
        title: 'Review me',
        description: 'A local work item awaiting review.',
        status: 'aiDone',
        type: 'work-item',
        source: 'manual',
        tracker: { kind: 'local-only' },
        createdAt: now,
        updatedAt: now,
        plan: { version: 3, currentVersion: 3, content: '## Plan\nDo the thing', updatedAt: now },
        currentContentVersion: 3,
        executionHistory: [{
            taskId: 'task-impl',
            status: 'completed',
            startedAt: now,
            completedAt: now,
            planVersion: 3,
            title: 'Code Implement',
        }],
        changes: [{
            id: 'change-impl',
            planVersion: 3,
            taskId: 'task-impl',
            startedAt: now,
            completedAt: now,
            status: 'closed',
            commits: [{ sha: 'abc123', message: 'Implement the thing' }],
        }],
        ...overrides,
    } as WorkItem);
}

function review(body: Record<string, unknown> = {}, scope: { storageRepoId?: string; commandRepoId?: string } = {}) {
    return startWorkItemAiReviewCommand(ctx, {
        workItemId: WORK_ITEM_ID,
        storageRepoId: scope.storageRepoId ?? REPO_ID,
        commandRepoId: scope.commandRepoId ?? REPO_ID,
        settings: parseWorkItemAiSettings(body),
    });
}

describe('startWorkItemAiReviewCommand', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-review-cmd-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        enqueued = undefined;
        enqueue = vi.fn(async (task: any) => { enqueued = task; return 'task-review-1'; });
        ctx = {
            workItemStore: store,
            processStore: { getWorkspaces: vi.fn().mockResolvedValue([]) } as any,
            enqueue: enqueue as any,
        };
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('derives the queue config and the execution history aiSettings from one parsed input', async () => {
        await addReviewItem();

        const result = await review({
            model: 'claude-opus-5',
            provider: 'claude',
            reasoningEffort: 'high',
            effortTier: 'low',
            autoProviderRouting: true,
        });

        expect(result.taskId).toBe('task-review-1');
        expect(enqueued.config).toEqual({
            model: 'claude-opus-5',
            reasoningEffort: 'high',
            effortTier: 'low',
        });
        expect(enqueued.payload.provider).toBe('claude');
        expect(enqueued.payload.reasoningEffort).toBe('high');
        expect(enqueued.payload.context.autoProviderRouting).toEqual({ requested: true });

        const entry = result.workItem?.executionHistory?.find(e => e.taskId === 'task-review-1');
        expect(entry?.aiSettings).toEqual({
            provider: 'claude',
            model: 'claude-opus-5',
            reasoningEffort: 'high',
            effortTier: 'low',
            autoProviderRouting: true,
        });
        // History metadata mirrors the queue config for every shared field.
        expect(entry?.aiSettings?.model).toBe(enqueued.config.model);
        expect(entry?.aiSettings?.reasoningEffort).toBe(enqueued.config.reasoningEffort);
        expect(entry?.aiSettings?.effortTier).toBe(enqueued.config.effortTier);
    });

    it('records no aiSettings and an empty config when nothing was selected', async () => {
        await addReviewItem();

        const result = await review({});

        expect(enqueued.config).toEqual({});
        expect(enqueued.payload.provider).toBeUndefined();
        expect(enqueued.payload.context.autoProviderRouting).toBeUndefined();
        const entry = result.workItem?.executionHistory?.find(e => e.taskId === 'task-review-1');
        expect(entry?.aiSettings).toBeUndefined();
    });

    it('queues an ask-mode review pinned to the reviewed execution and change', async () => {
        await addReviewItem();

        await review();

        expect(enqueued.type).toBe('run-workflow');
        expect(enqueued.repoId).toBe(REPO_ID);
        expect(enqueued.displayName).toBe('Run #2: AI Review');
        expect(enqueued.payload.mode).toBe('ask');
        expect(enqueued.payload.sessionCategory).toBe('work-item-ai-review');
        expect(enqueued.payload.planVersion).toBe(3);
        expect(enqueued.payload.context.skills).toEqual(['code-review']);
        expect(enqueued.payload.context.workItemReview).toEqual({
            workspaceId: REPO_ID,
            originId: REPO_ID,
            workItemId: WORK_ITEM_ID,
            executionTaskId: 'task-impl',
            executionRunIndex: 1,
            changeId: 'change-impl',
            commits: ['abc123'],
        });
        expect(enqueued.payload.prompt).toContain('# Work Item AI Review: Review me');
        expect(enqueued.payload.prompt).toContain('- abc123 Implement the thing');
        expect(enqueued.payload.prompt).toContain('## Verdict');
    });

    it('keeps the storage scope for history and the command scope for queue routing', async () => {
        const originId = 'gh_example_repo';
        await addReviewItem({ repoId: originId } as Partial<WorkItem>);

        const result = await review({}, { storageRepoId: originId, commandRepoId: 'clone-a' });

        expect(enqueued.repoId).toBe('clone-a');
        expect(enqueued.payload.workspaceId).toBe('clone-a');
        expect(enqueued.payload.workItemStorageRepoId).toBe(originId);
        expect(enqueued.payload.context.workItemReview.originId).toBe(originId);
        expect(result.workItem?.executionHistory?.some(e => e.taskId === 'task-review-1')).toBe(true);
        expect((await store.getWorkItem(WORK_ITEM_ID, originId))?.executionHistory).toHaveLength(2);
    });

    it('rejects invalid AI settings before anything is queued', async () => {
        await addReviewItem();

        expect(() => parseWorkItemAiSettings({ provider: 'nope' })).toThrow(APIError);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('rejects a second concurrent review', async () => {
        await addReviewItem();
        await review();

        await expect(review()).rejects.toThrow('already running');
    });

    it('rejects items that are not in Review and non-local items', async () => {
        await addReviewItem({ status: 'inProgress' } as Partial<WorkItem>);
        await expect(review()).rejects.toThrow("Cannot start AI review in status 'inProgress'");

        await store.updateWorkItem(WORK_ITEM_ID, { status: 'aiDone' }, REPO_ID);
        await store.updateWorkItem(WORK_ITEM_ID, {
            tracker: { kind: 'github', github: { issueNumber: 3 } },
        } as any, REPO_ID);
        await expect(review()).rejects.toThrow('only available for local-only');
    });

    it('returns 404 for a missing work item', async () => {
        await expect(review()).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('findLatestImplementationExecution', () => {
    const done = { status: 'completed' as const, startedAt: 'now' };

    it('ignores resolve and review runs', () => {
        const item = {
            executionHistory: [
                { ...done, taskId: 'impl-1' },
                { ...done, taskId: 'impl-2' },
                { ...done, taskId: 'resolve-1', sessionCategory: 'resolve-plan-comments' },
                { ...done, taskId: 'resolve-2', sessionCategory: 'resolve-commit-comments' },
                { ...done, taskId: 'review-1', sessionCategory: 'work-item-ai-review' },
            ],
        } as unknown as WorkItem;
        const latest = findLatestImplementationExecution(item);
        expect(latest?.execution.taskId).toBe('impl-2');
        expect(latest?.index).toBe(1);
    });

    it('ignores runs that are not completed', () => {
        const item = {
            executionHistory: [
                { ...done, taskId: 'impl-1' },
                { taskId: 'impl-2', status: 'running', startedAt: 'now' },
                { taskId: 'impl-3', status: 'failed', startedAt: 'now' },
            ],
        } as unknown as WorkItem;
        expect(findLatestImplementationExecution(item)?.execution.taskId).toBe('impl-1');
    });

    it('returns undefined without history', () => {
        expect(findLatestImplementationExecution({} as WorkItem)).toBeUndefined();
        expect(findLatestImplementationExecution({ executionHistory: [] } as unknown as WorkItem)).toBeUndefined();
    });
});
