import { describe, it, expect } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { getRepoIdentifierFromQuery, serializeTaskSummary, serializeQueueItemSummary } from '../../src/server/routes/queue-shared';

function makeTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'task-1',
        type: 'chat',
        priority: 'normal',
        status: 'completed',
        createdAt: 1000,
        payload: {},
        config: { retryOnFailure: false },
        ...overrides,
    };
}

describe('serializeTaskSummary', () => {
    it('includes all metadata fields', () => {
        const task = makeTask({
            id: 't-42',
            repoId: 'repo-abc',
            folderPath: '/foo/bar',
            type: 'run-workflow',
            priority: 'high',
            status: 'completed',
            createdAt: 1000,
            startedAt: 2000,
            completedAt: 3000,
            displayName: 'My Task',
            processId: 'proc-1',
            retryCount: 2,
            frozen: true,
            admitted: true,
        });
        const out = serializeTaskSummary(task);
        expect(out.id).toBe('t-42');
        expect(out.repoId).toBe('repo-abc');
        expect(out.folderPath).toBe('/foo/bar');
        expect(out.type).toBe('run-workflow');
        expect(out.priority).toBe('high');
        expect(out.status).toBe('completed');
        expect(out.createdAt).toBe(1000);
        expect(out.startedAt).toBe(2000);
        expect(out.completedAt).toBe(3000);
        expect(out.displayName).toBe('My Task');
        expect(out.processId).toBe('proc-1');
        expect(out.retryCount).toBe(2);
        expect(out.frozen).toBe(true);
        expect(out.admitted).toBe(true);
    });

    it('omits result', () => {
        const task = makeTask({ result: { output: 'x'.repeat(10000) } });
        const out = serializeTaskSummary(task);
        expect(out).not.toHaveProperty('result');
    });

    it('omits config', () => {
        const task = makeTask({
            config: { model: 'gpt-4', timeoutMs: 30000, retryOnFailure: true },
        });
        const out = serializeTaskSummary(task);
        expect(out).not.toHaveProperty('config');
    });

    it('slim payload includes expected fields', () => {
        const task = makeTask({
            payload: {
                mode: 'autopilot',
                kind: 'chat',
                prompt: 'hello',
                promptContent: 'world',
                planFilePath: '/plans/p.md',
                filePath: '/src/a.ts',
                workflowPath: '/workflows/build.yaml',
                workingDirectory: '/repo',
                workspaceId: 'ws-1',
                scheduleId: 'sched-1',
            },
        });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.mode).toBe('autopilot');
        expect(p.kind).toBe('chat');
        expect(p.prompt).toBe('hello');
        expect(p.promptContent).toBe('world');
        expect(p.planFilePath).toBe('/plans/p.md');
        expect(p.filePath).toBe('/src/a.ts');
        expect(p.workflowPath).toBe('/workflows/build.yaml');
        expect(p.workingDirectory).toBe('/repo');
        expect(p.workspaceId).toBe('ws-1');
        expect(p.scheduleId).toBe('sched-1');
    });

    it('slim payload omits non-listed fields', () => {
        const task = makeTask({
            payload: {
                mode: 'autopilot',
                someHeavyData: 'x'.repeat(5000),
                internalState: { foo: 'bar' },
            },
        });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p).not.toHaveProperty('someHeavyData');
        expect(p).not.toHaveProperty('internalState');
    });

    it('truncates prompt at 200 chars', () => {
        const longPrompt = 'a'.repeat(300);
        const task = makeTask({ payload: { prompt: longPrompt } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect((p.prompt as string).length).toBe(200);
        expect((p.prompt as string).endsWith('…')).toBe(true);
    });

    it('truncates promptContent at 200 chars', () => {
        const longContent = 'b'.repeat(300);
        const task = makeTask({ payload: { promptContent: longContent } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect((p.promptContent as string).length).toBe(200);
        expect((p.promptContent as string).endsWith('…')).toBe(true);
    });

    it('does not truncate short prompt', () => {
        const shortPrompt = 'c'.repeat(50);
        const task = makeTask({ payload: { prompt: shortPrompt } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.prompt).toBe(shortPrompt);
    });

    it('truncates error at 500 chars', () => {
        const longError = 'd'.repeat(1000);
        const task = makeTask({ error: longError });
        const out = serializeTaskSummary(task);
        expect((out.error as string).length).toBe(500);
        expect((out.error as string).endsWith('…')).toBe(true);
    });

    it('does not truncate short error', () => {
        const shortError = 'e'.repeat(100);
        const task = makeTask({ error: shortError });
        const out = serializeTaskSummary(task);
        expect(out.error).toBe(shortError);
    });

    it('computes imagesCount from images array', () => {
        const task = makeTask({ payload: { images: ['a', 'b', 'c'] } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.imagesCount).toBe(3);
        expect(p.hasImages).toBe(true);
        expect(p).not.toHaveProperty('images');
    });

    it('reads imagesCount from pre-existing count', () => {
        const task = makeTask({ payload: { imagesCount: 5 } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.imagesCount).toBe(5);
    });

    it('hasImages true when imagesFilePath set', () => {
        const task = makeTask({ payload: { imagesFilePath: '/path' } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.hasImages).toBe(true);
    });

    it('preserves data.originalTaskPath', () => {
        const task = makeTask({
            payload: {
                data: { originalTaskPath: '/tasks/foo.md', otherField: 'ignored' },
            },
        });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect((p.data as any).originalTaskPath).toBe('/tasks/foo.md');
        expect((p.data as any).otherField).toBeUndefined();
    });

    it('preserves context.files and omits other context sub-fields', () => {
        const task = makeTask({
            payload: {
                context: { files: ['a.ts', 'b.ts'], skills: ['some-skill'] },
            },
        });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect((p.context as any).files).toEqual(['a.ts', 'b.ts']);
        expect((p.context as any).skills).toBeUndefined();
    });

    it('frozen and admitted undefined when falsy', () => {
        const task = makeTask();
        const out = serializeTaskSummary(task);
        expect(out.frozen).toBeUndefined();
        expect(out.admitted).toBeUndefined();
    });

    it('handles empty payload gracefully', () => {
        const task = makeTask({ payload: {} });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.imagesCount).toBe(0);
        expect(p.hasImages).toBe(false);
    });

    // Regression: provider was omitted from slimPayload, causing running/queued
    // Codex and Claude tasks to always render with Copilot green in ChatListPane.
    it('preserves provider=codex in slim payload', () => {
        const task = makeTask({ payload: { mode: 'autopilot', provider: 'codex' } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.provider).toBe('codex');
    });

    it('preserves provider=claude in slim payload', () => {
        const task = makeTask({ payload: { mode: 'autopilot', provider: 'claude' } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.provider).toBe('claude');
    });

    it('preserves provider=copilot in slim payload', () => {
        const task = makeTask({ payload: { provider: 'copilot' } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.provider).toBe('copilot');
    });

    it('provider is undefined when not set in payload', () => {
        const task = makeTask({ payload: { mode: 'autopilot' } });
        const out = serializeTaskSummary(task);
        const p = out.payload as Record<string, unknown>;
        expect(p.provider).toBeUndefined();
    });
});

describe('serializeQueueItemSummary', () => {
    it('passes through pause markers unchanged', () => {
        const marker = { kind: 'pause-marker' as const, id: 'pm-1', createdAt: 123 };
        const out = serializeQueueItemSummary(marker);
        expect(out).toEqual({ kind: 'pause-marker', id: 'pm-1', createdAt: 123 });
    });

    it('uses summary serialization for tasks', () => {
        const task = makeTask({
            result: { big: 'data' },
            config: { model: 'gpt-4', retryOnFailure: false },
        });
        const out = serializeQueueItemSummary(task);
        expect(out).not.toHaveProperty('result');
        expect(out).not.toHaveProperty('config');
        expect(out).toEqual(serializeTaskSummary(task));
    });
});

describe('getRepoIdentifierFromQuery', () => {
    it('accepts workspace as the preferred queue repo identifier alias', () => {
        expect(getRepoIdentifierFromQuery({ workspace: 'workspace-a', repoId: 'repo-a' })).toBe('workspace-a');
        expect(getRepoIdentifierFromQuery({ repoId: 'repo-a' })).toBe('repo-a');
    });

    it('ignores empty and non-string query values', () => {
        expect(getRepoIdentifierFromQuery({ workspace: '', repoId: 'repo-a' })).toBe('repo-a');
        expect(getRepoIdentifierFromQuery({ workspace: ['workspace-a', 'workspace-b'] })).toBe('workspace-a');
        expect(getRepoIdentifierFromQuery({ workspace: [], repoId: [] })).toBeUndefined();
    });
});
