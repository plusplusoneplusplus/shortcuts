import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    executeWorkItem,
    handleWorkItemTaskComplete,
    buildExecutionPrompt,
    resolveWorkItemComments,
    isResolveSessionCategory,
    extractGoalSpecFromGrillingResponse,
    saveGoalGrillingSpecFromResponse,
} from '../../../src/server/work-items/work-item-executor';
import type { WorkItem } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-exec-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('buildExecutionPrompt', () => {
    it('includes title, description, and plan', () => {
        const item = makeWorkItem({
            title: 'Refactor auth',
            description: 'Refactor the authentication module',
            plan: { version: 1, content: '1. Extract token logic\n2. Add tests', updatedAt: '' },
        });

        const prompt = buildExecutionPrompt(item);
        expect(prompt).toContain('Refactor auth');
        expect(prompt).toContain('Refactor the authentication module');
        expect(prompt).toContain('Extract token logic');
        expect(prompt).toContain('Execute the plan above');
    });

    it('works without plan', () => {
        const item = makeWorkItem({ title: 'Simple task', description: 'Do it' });
        const prompt = buildExecutionPrompt(item);
        expect(prompt).toContain('Simple task');
        expect(prompt).toContain('Do it');
    });
});

describe('executeWorkItem', () => {
    it('enqueues a task and transitions to executing', async () => {
        const item = makeWorkItem({
            id: 'wi-exec-1',
            status: 'readyToExecute',
            plan: { version: 1, content: 'Plan content', updatedAt: '' },
            priority: 'high',
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-123');

        const result = await executeWorkItem('wi-exec-1', store, enqueue);

        expect(result.taskId).toBe('task-123');
        expect(enqueue).toHaveBeenCalledOnce();

        const call = enqueue.mock.calls[0][0];
        expect(call.type).toBe('run-workflow');
        expect(call.priority).toBe('high');
        expect(call.payload.kind).toBe('chat');
        expect(call.payload.mode).toBe('autopilot');
        expect(call.payload.prompt).toContain('Plan content');
        expect(call.payload.workItemId).toBe('wi-exec-1');
        expect(call.payload.planVersion).toBe(1);
        expect(call.displayName).toBe('Run #1: Code Implement');

        // Verify status transitioned
        const updated = await store.getWorkItem('wi-exec-1', 'test-repo');
        expect(updated!.status).toBe('executing');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].taskId).toBe('task-123');
        expect(updated!.executionHistory![0].status).toBe('running');
        expect(updated!.executionHistory![0].planVersion).toBe(1);
        expect(updated!.executionHistory![0].executionMode).toBe('one-shot');
    });

    it('throws for non-ready work items', async () => {
        const item = makeWorkItem({ id: 'wi-not-ready', status: 'created' });
        await store.addWorkItem(item);

        const enqueue = vi.fn();
        await expect(executeWorkItem('wi-not-ready', store, enqueue)).rejects.toThrow(
            /Cannot execute.*created/
        );
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('throws for non-existent work items', async () => {
        const enqueue = vi.fn();
        await expect(executeWorkItem('nonexistent', store, enqueue)).rejects.toThrow('not found');
    });

    it('respects model override', async () => {
        const item = makeWorkItem({ id: 'wi-model', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-456');
        await executeWorkItem('wi-model', store, enqueue, { model: 'gpt-4' });

        const call = enqueue.mock.calls[0][0];
        expect(call.config.model).toBe('gpt-4');
    });

    it('passes provider and reasoning effort overrides through the queued chat task', async () => {
        const item = makeWorkItem({ id: 'wi-provider-effort', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-provider-effort');
        await executeWorkItem('wi-provider-effort', store, enqueue, {
            provider: 'codex',
            reasoningEffort: 'high',
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.provider).toBe('codex');
        expect(call.payload.reasoningEffort).toBe('high');
        expect(call.config.reasoningEffort).toBe('high');
        expect(call.config.model).toBeUndefined();

        const updated = await store.getWorkItem('wi-provider-effort', 'test-repo');
        expect(updated!.executionHistory![0].aiSettings).toEqual({
            provider: 'codex',
            reasoningEffort: 'high',
        });
    });

    it('omits provider/model/reasoning effort when no override is selected', async () => {
        const item = makeWorkItem({ id: 'wi-default-ai', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-default-ai');
        await executeWorkItem('wi-default-ai', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.provider).toBeUndefined();
        expect(call.payload.model).toBeUndefined();
        expect(call.payload.reasoningEffort).toBeUndefined();
        expect(call.config.model).toBeUndefined();
        expect(call.config.reasoningEffort).toBeUndefined();
    });

    it('includes context.skills when skillNames provided', async () => {
        const item = makeWorkItem({ id: 'wi-skills', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-sk1');
        await executeWorkItem('wi-skills', store, enqueue, {
            skillNames: ['impl', 'code-review'],
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.context).toBeDefined();
        expect(call.payload.context.skills).toEqual(['impl', 'code-review']);
        expect(call.payload.context.files).toBeUndefined();

        const updated = await store.getWorkItem('wi-skills', 'test-repo');
        expect(updated!.executionHistory![0].skillNames).toEqual(['impl', 'code-review']);
    });

    it('defaults Goals to Ralph execution and preserves Work Item linkage on the queued Ralph task', async () => {
        const item = makeWorkItem({
            id: 'goal-exec-1',
            type: 'goal',
            status: 'readyToExecute',
            plan: { version: 2, currentVersion: 2, content: '## Goal\nShip it', updatedAt: '' },
            currentContentVersion: 2,
            tracker: { kind: 'local-only' },
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-ralph-1');
        const result = await executeWorkItem('goal-exec-1', store, enqueue, {
            dataDir: tmpDir,
            maxRalphIterations: 7,
            provider: 'claude',
            model: 'claude-sonnet-4.6',
            skillNames: ['impl'],
        });

        expect(result.taskId).toBe('task-ralph-1');
        expect(result.ralphSessionId).toMatch(/^ralph-/);
        const call = enqueue.mock.calls[0][0];
        expect(call.type).toBe('chat');
        expect(call.repoId).toBe('test-repo');
        expect(call.displayName).toBe('Run #1: Ralph Implement');
        expect(call.payload).toMatchObject({
            kind: 'chat',
            mode: 'ralph',
            workspaceId: 'test-repo',
            workItemId: 'goal-exec-1',
            planVersion: 2,
            sessionCategory: 'generating-code',
            provider: 'claude',
        });
        expect(call.payload.context.skills).toEqual(['impl']);
        expect(call.payload.context.ralph).toMatchObject({
            phase: 'executing',
            sessionId: result.ralphSessionId,
            currentIteration: 1,
            maxIterations: 7,
        });
        expect(call.config.model).toBe('claude-sonnet-4.6');

        const updated = await store.getWorkItem('goal-exec-1', 'test-repo');
        expect(updated!.status).toBe('executing');
        expect(updated!.executionHistory![0]).toMatchObject({
            taskId: 'task-ralph-1',
            planVersion: 2,
            executionMode: 'ralph',
            ralphSessionId: result.ralphSessionId,
            title: 'Ralph Implement',
            aiSettings: {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
            },
            skillNames: ['impl'],
        });
    });

    it('includes both context.files and context.skills when both provided', async () => {
        const item = makeWorkItem({ id: 'wi-both', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-both');
        await executeWorkItem('wi-both', store, enqueue, {
            taskFilePath: '/tmp/task.md',
            skillNames: ['impl'],
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.context).toBeDefined();
        expect(call.payload.context.files).toEqual(['/tmp/task.md']);
        expect(call.payload.context.skills).toEqual(['impl']);
    });

    it('omits context when no taskFilePath or skillNames', async () => {
        const item = makeWorkItem({ id: 'wi-no-ctx', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-noctx');
        await executeWorkItem('wi-no-ctx', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.context).toBeUndefined();
    });
});

describe('handleWorkItemTaskComplete', () => {
    it('marks work item done on completion', async () => {
        const item = makeWorkItem({ id: 'wi-done', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-done', {
            taskId: 'task-1',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-done', 'task-1', {
            status: 'completed',
            processId: 'proc-1',
        }, store);

        const updated = await store.getWorkItem('wi-done', 'test-repo');
        expect(updated!.status).toBe('aiDone');
        expect(updated!.processId).toBe('proc-1');
        expect(updated!.executionHistory![0].status).toBe('completed');
    });

    it('marks work item aiFailed on failure', async () => {
        const item = makeWorkItem({ id: 'wi-fail', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-fail', {
            taskId: 'task-2',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-fail', 'task-2', {
            status: 'failed',
            error: 'Timeout exceeded',
        }, store);

        const updated = await store.getWorkItem('wi-fail', 'test-repo');
        expect(updated!.status).toBe('aiFailed');
        expect(updated!.completedAt).toBeDefined();
        expect(updated!.executionHistory![0].status).toBe('failed');
        expect(updated!.executionHistory![0].error).toBe('Timeout exceeded');
    });

    it('transitions to readyToExecute on cancellation', async () => {
        const item = makeWorkItem({ id: 'wi-cancel', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-cancel', {
            taskId: 'task-cancel',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-cancel', 'task-cancel', {
            status: 'cancelled',
        }, store);

        const updated = await store.getWorkItem('wi-cancel', 'test-repo');
        expect(updated!.status).toBe('readyToExecute');
        expect(updated!.completedAt).toBeUndefined();
        expect(updated!.executionHistory![0].status).toBe('cancelled');
    });

    it('does not set completedAt when transitioning to aiDone', async () => {
        const item = makeWorkItem({ id: 'wi-aidone', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-aidone', {
            taskId: 'task-3',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-aidone', 'task-3', {
            status: 'completed',
            processId: 'proc-2',
        }, store);

        const updated = await store.getWorkItem('wi-aidone', 'test-repo');
        expect(updated!.status).toBe('aiDone');
        expect(updated!.completedAt).toBeUndefined();
    });
});

describe('Goal grilling spec persistence', () => {
    it('extracts the final goal spec block from plain or fenced responses', () => {
        expect(extractGoalSpecFromGrillingResponse('Before\n\n## Goal\nShip it\n\n## Acceptance Criteria\n- Works'))
            .toBe('## Goal\nShip it\n\n## Acceptance Criteria\n- Works');
        expect(extractGoalSpecFromGrillingResponse('```markdown\n## Goal\nShip it\n```'))
            .toBe('## Goal\nShip it');
        expect(extractGoalSpecFromGrillingResponse('I need one more answer.')).toBeUndefined();
    });

    it('saves a completed local Goal grilling response as a new AI-authored content version', async () => {
        const item = makeWorkItem({
            id: 'goal-grill-save',
            type: 'goal',
            title: 'Durable goals',
            status: 'drafting',
            tracker: { kind: 'local-only' },
            grillSessionId: 'queue_grill-task',
        });
        await store.addWorkItem(item);

        const updated = await saveGoalGrillingSpecFromResponse({
            workspaceId: 'test-repo',
            workItemId: 'goal-grill-save',
            processId: 'queue_grill-task',
            responseText: [
                'Here is the final spec:',
                '',
                '## Goal',
                'Make Goals durable.',
                '',
                '## Acceptance Criteria',
                '- Goal specs are versioned.',
            ].join('\n'),
            store,
        });

        expect(updated).toBeDefined();
        expect(updated!.status).toBe('readyToExecute');
        expect(updated!.currentContentVersion).toBe(1);
        expect(updated!.plan).toMatchObject({
            version: 1,
            currentVersion: 1,
            resolvedBy: 'ai',
            source: 'ai',
            reason: 'Goal spec synthesized from grilling session',
        });
        expect(updated!.plan!.content).toContain('## Goal\nMake Goals durable.');

        const versions = await store.getPlanVersions('goal-grill-save');
        expect(versions).toHaveLength(1);
        expect(versions[0]).toMatchObject({
            version: 1,
            resolvedBy: 'ai',
            source: 'ai',
            authorType: 'ai',
            reason: 'Goal spec synthesized from grilling session',
            summary: 'Goal spec synthesized from queue_grill-task',
        });

        const changes = await store.getChanges('goal-grill-save');
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ planVersion: 1, status: 'open', commits: [] });
    });

    it('creates a new version instead of overwriting an existing Goal content version', async () => {
        const item = makeWorkItem({
            id: 'goal-grill-revise',
            type: 'goal',
            status: 'drafting',
            tracker: { kind: 'local-only' },
            plan: {
                version: 1,
                currentVersion: 1,
                content: '## Goal\nInitial spec',
                updatedAt: '2026-01-01T00:00:00.000Z',
                resolvedBy: 'user',
                source: 'user',
            },
            currentContentVersion: 1,
        });
        await store.addWorkItem(item);

        const updated = await saveGoalGrillingSpecFromResponse({
            workspaceId: 'test-repo',
            workItemId: 'goal-grill-revise',
            responseText: '## Goal\nRevised spec\n\n## Acceptance Criteria\n- Better',
            store,
        });

        expect(updated!.currentContentVersion).toBe(2);
        expect(updated!.plan!.content).toContain('Revised spec');
        const versions = await store.getPlanVersions('goal-grill-revise');
        expect(versions.map(version => version.version)).toEqual([1, 2]);
        expect(versions[0].content).toContain('Initial spec');
        expect(versions[1].source).toBe('ai');
    });

    it('does not duplicate a saved Goal spec for repeated completion events from the same process', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'goal-grill-idempotent',
            type: 'goal',
            status: 'drafting',
            tracker: { kind: 'local-only' },
        }));

        const options = {
            workspaceId: 'test-repo',
            workItemId: 'goal-grill-idempotent',
            processId: 'queue_same-grill-process',
            responseText: '## Goal\nPersist once\n\n## Acceptance Criteria\n- No duplicate versions',
            store,
        };

        await saveGoalGrillingSpecFromResponse(options);
        await saveGoalGrillingSpecFromResponse(options);

        const versions = await store.getPlanVersions('goal-grill-idempotent');
        expect(versions).toHaveLength(1);
        expect(versions[0].summary).toBe('Goal spec synthesized from queue_same-grill-process');
    });

    it('does not persist clarification turns or non-local Goal targets', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'goal-clarifying',
            type: 'goal',
            status: 'drafting',
            tracker: { kind: 'local-only' },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'wi-not-goal',
            type: 'work-item',
            status: 'drafting',
            tracker: { kind: 'local-only' },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'goal-remote',
            type: 'goal',
            status: 'drafting',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: { issueNumber: 1 },
            },
        }));

        await expect(saveGoalGrillingSpecFromResponse({
            workspaceId: 'test-repo',
            workItemId: 'goal-clarifying',
            responseText: 'What deployment target should this support?',
            store,
        })).resolves.toBeUndefined();
        await expect(saveGoalGrillingSpecFromResponse({
            workspaceId: 'test-repo',
            workItemId: 'wi-not-goal',
            responseText: '## Goal\nNot a Goal item',
            store,
        })).resolves.toBeUndefined();
        await expect(saveGoalGrillingSpecFromResponse({
            workspaceId: 'test-repo',
            workItemId: 'goal-remote',
            responseText: '## Goal\nRemote Goal item',
            store,
        })).resolves.toBeUndefined();

        expect(await store.getPlanVersions('goal-clarifying')).toEqual([]);
        expect(await store.getPlanVersions('wi-not-goal')).toEqual([]);
        expect(await store.getPlanVersions('goal-remote')).toEqual([]);
    });
});

describe('executeWorkItem sessionCategory', () => {
    it('sets sessionCategory to generating-code in the enqueue payload', async () => {
        const item = makeWorkItem({ id: 'wi-cat-payload', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-cat-1');
        await executeWorkItem('wi-cat-payload', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.sessionCategory).toBe('generating-code');
    });

    it('sets sessionCategory to generating-code in the execution history record', async () => {
        const item = makeWorkItem({ id: 'wi-cat-exec', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-cat-2');
        await executeWorkItem('wi-cat-exec', store, enqueue);

        const updated = await store.getWorkItem('wi-cat-exec', 'test-repo');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].sessionCategory).toBe('generating-code');
    });
});

describe('executeWorkItem title', () => {
    it('sets title to "Code Implement" on the execution entry', async () => {
        const item = makeWorkItem({ id: 'wi-title-1', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-title-1');
        await executeWorkItem('wi-title-1', store, enqueue);

        const updated = await store.getWorkItem('wi-title-1', 'test-repo');
        expect(updated!.executionHistory![0].title).toBe('Code Implement');
    });

    it('sets displayName to "Run #1: Code Implement" for the first execution', async () => {
        const item = makeWorkItem({ id: 'wi-dn-1', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-dn-1');
        await executeWorkItem('wi-dn-1', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.displayName).toBe('Run #1: Code Implement');
    });

    it('increments run number based on existing execution history', async () => {
        const item = makeWorkItem({
            id: 'wi-dn-2',
            status: 'readyToExecute',
            executionHistory: [
                { taskId: 'prev-1', startedAt: '2026-01-01T00:00:00Z', status: 'completed', title: 'Code Implement' },
                { taskId: 'prev-2', startedAt: '2026-01-01T01:00:00Z', status: 'completed', title: 'Resolve comments for Run #1' },
            ],
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-dn-3');
        await executeWorkItem('wi-dn-2', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.displayName).toBe('Run #3: Code Implement');
    });

    it('preserves title "Code Implement" on auto-re-executed runs', async () => {
        const item = makeWorkItem({ id: 'wi-auto-title', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-auto-title');
        await executeWorkItem('wi-auto-title', store, enqueue, { autoReExecuted: true });

        const updated = await store.getWorkItem('wi-auto-title', 'test-repo');
        expect(updated!.executionHistory![0].title).toBe('Code Implement');
        expect(updated!.executionHistory![0].autoReExecuted).toBe(true);
    });
});

describe('executeWorkItem taskFilePath (live task visibility)', () => {
    it('includes taskFilePath in context.files when provided', async () => {
        const item = makeWorkItem({ id: 'wi-taskfile-1', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-tf-1');
        const taskFilePath = '/data/repos/ws-abc/tasks/work-items/wi-taskfile-1.impl.md';
        await executeWorkItem('wi-taskfile-1', store, enqueue, { taskFilePath });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.context).toEqual({ files: [taskFilePath] });
    });

    it('omits context.files when taskFilePath is not provided', async () => {
        const item = makeWorkItem({ id: 'wi-taskfile-2', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-tf-2');
        await executeWorkItem('wi-taskfile-2', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.context).toBeUndefined();
    });

    it('includes taskFilePath alongside other payload fields', async () => {
        const item = makeWorkItem({
            id: 'wi-taskfile-3',
            status: 'readyToExecute',
            plan: { version: 1, content: 'Do stuff', updatedAt: '' },
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-tf-3');
        const taskFilePath = '/data/repos/ws-xyz/tasks/work-items/wi-taskfile-3.impl.md';
        await executeWorkItem('wi-taskfile-3', store, enqueue, { taskFilePath, model: 'gpt-4' });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.workItemId).toBe('wi-taskfile-3');
        expect(call.payload.workspaceId).toBe('test-repo');
        expect(call.payload.context).toEqual({ files: [taskFilePath] });
        expect(call.config.model).toBe('gpt-4');
    });
});

describe('resolveWorkItemComments', () => {
    it('creates a plan comment resolve Run# session', async () => {
        const item = makeWorkItem({ id: 'wi-plan-resolve', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-resolve-1');
        const result = await resolveWorkItemComments('wi-plan-resolve', store, enqueue, {
            type: 'plan',
            prompt: 'Resolve these plan comments...',
            resolveContext: { files: ['__wi-plan__/wi-plan-resolve'] },
        });

        expect(result.taskId).toBe('task-resolve-1');
        expect(enqueue).toHaveBeenCalledOnce();

        const call = enqueue.mock.calls[0][0];
        expect(call.type).toBe('run-workflow');
        expect(call.payload.kind).toBe('chat');
        expect(call.payload.mode).toBe('ask');
        expect(call.payload.sessionCategory).toBe('resolve-plan-comments');
        expect(call.payload.workItemId).toBe('wi-plan-resolve');
        expect(call.payload.tools).toEqual(['resolve-comments']);
        expect(call.displayName).toBe('Run #1: Comment Resolve');

        const updated = await store.getWorkItem('wi-plan-resolve', 'test-repo');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].taskId).toBe('task-resolve-1');
        expect(updated!.executionHistory![0].status).toBe('running');
        expect(updated!.executionHistory![0].sessionCategory).toBe('resolve-plan-comments');
        expect(updated!.executionHistory![0].title).toBe('Comment Resolve');

        // Should NOT change the work item status
        expect(updated!.status).toBe('readyToExecute');
    });

    it('creates a commit comment resolve Run# session with SHA in title', async () => {
        const item = makeWorkItem({ id: 'wi-commit-resolve', status: 'aiDone' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-resolve-2');
        await resolveWorkItemComments('wi-commit-resolve', store, enqueue, {
            type: 'commit',
            commitSha: 'abc1234567890',
            prompt: 'Resolve commit diff comments...',
            resolveContext: { files: ['/repo/src/file.ts'] },
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.mode).toBe('autopilot');
        expect(call.payload.sessionCategory).toBe('resolve-commit-comments');
        expect(call.displayName).toBe('Run #1: Code Comment Resolve (abc1234)');

        const updated = await store.getWorkItem('wi-commit-resolve', 'test-repo');
        expect(updated!.executionHistory![0].title).toBe('Code Comment Resolve (abc1234)');
        expect(updated!.executionHistory![0].sessionCategory).toBe('resolve-commit-comments');
    });

    it('increments run number based on existing execution history', async () => {
        const item = makeWorkItem({
            id: 'wi-resolve-num',
            status: 'aiDone',
            executionHistory: [
                { taskId: 'prev-1', startedAt: '2026-01-01T00:00:00Z', status: 'completed', title: 'Code Implement' },
            ],
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-resolve-num');
        await resolveWorkItemComments('wi-resolve-num', store, enqueue, {
            type: 'plan',
            prompt: 'Resolve...',
            resolveContext: {},
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.displayName).toBe('Run #2: Comment Resolve');
    });

    it('throws for non-existent work items', async () => {
        const enqueue = vi.fn();
        await expect(
            resolveWorkItemComments('nonexistent', store, enqueue, {
                type: 'plan',
                prompt: 'test',
                resolveContext: {},
            }),
        ).rejects.toThrow('not found');
    });

    it('respects model override', async () => {
        const item = makeWorkItem({ id: 'wi-resolve-model', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-resolve-model');
        await resolveWorkItemComments('wi-resolve-model', store, enqueue, {
            type: 'plan',
            model: 'claude-sonnet',
            prompt: 'Resolve...',
            resolveContext: {},
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.config.model).toBe('claude-sonnet');
    });

    it('respects mode override', async () => {
        const item = makeWorkItem({ id: 'wi-resolve-mode', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-resolve-mode');
        await resolveWorkItemComments('wi-resolve-mode', store, enqueue, {
            type: 'commit',
            commitSha: 'abc123',
            mode: 'ask',
            prompt: 'Resolve...',
            resolveContext: {},
        });

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.mode).toBe('ask');
    });
});

describe('isResolveSessionCategory', () => {
    it('returns true for resolve-plan-comments', () => {
        expect(isResolveSessionCategory('resolve-plan-comments')).toBe(true);
    });

    it('returns true for resolve-commit-comments', () => {
        expect(isResolveSessionCategory('resolve-commit-comments')).toBe(true);
    });

    it('returns false for generating-code', () => {
        expect(isResolveSessionCategory('generating-code')).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isResolveSessionCategory(undefined)).toBe(false);
    });
});

describe('handleWorkItemTaskComplete — comment-resolve sessions', () => {
    it('skips status transition for plan comment resolve sessions', async () => {
        const item = makeWorkItem({ id: 'wi-plan-done', status: 'aiDone' });
        await store.addWorkItem(item);
        await store.addExecution('wi-plan-done', {
            taskId: 'task-plan-resolve',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
            sessionCategory: 'resolve-plan-comments',
        });

        await handleWorkItemTaskComplete('wi-plan-done', 'task-plan-resolve', {
            status: 'completed',
            processId: 'proc-plan',
        }, store);

        const updated = await store.getWorkItem('wi-plan-done', 'test-repo');
        // Status should NOT change from aiDone
        expect(updated!.status).toBe('aiDone');
        // Execution entry should be updated
        expect(updated!.executionHistory![0].status).toBe('completed');
        expect(updated!.executionHistory![0].processId).toBe('proc-plan');
    });

    it('skips status transition for commit comment resolve sessions', async () => {
        const item = makeWorkItem({ id: 'wi-commit-done', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-commit-done', {
            taskId: 'task-commit-resolve',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
            sessionCategory: 'resolve-commit-comments',
        });

        await handleWorkItemTaskComplete('wi-commit-done', 'task-commit-resolve', {
            status: 'completed',
            processId: 'proc-commit',
        }, store);

        const updated = await store.getWorkItem('wi-commit-done', 'test-repo');
        // Status should NOT change
        expect(updated!.status).toBe('executing');
        expect(updated!.executionHistory![0].status).toBe('completed');
    });

    it('still transitions status for regular executions', async () => {
        const item = makeWorkItem({ id: 'wi-regular-done', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-regular-done', {
            taskId: 'task-regular',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
            sessionCategory: 'generating-code',
        });

        await handleWorkItemTaskComplete('wi-regular-done', 'task-regular', {
            status: 'completed',
            processId: 'proc-regular',
        }, store);

        const updated = await store.getWorkItem('wi-regular-done', 'test-repo');
        expect(updated!.status).toBe('aiDone');
    });
});
