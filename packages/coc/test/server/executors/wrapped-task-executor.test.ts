/**
 * WrappedTaskExecutor Unit Tests
 *
 * Verifies the before-script → AI → after-script orchestration,
 * including error handling, event emission, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { WrappedTaskExecutor } from '../../../src/server/executors/wrapped-task-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mock child_process
// ============================================================================

interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
        setImmediate(() => child.emit('close', null));
    });
    return child;
}

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const original = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...original,
        resolveSkill: vi.fn().mockRejectedValue(new original.SkillResolverError('not mocked', 'SKILL_NOT_FOUND')),
        getLogger: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
    };
});

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides?: Partial<QueuedTask>): QueuedTask {
    return {
        id: 'wrap-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'do something',
        },
        config: {},
        ...overrides,
    };
}

function makeInnerExecutor(result: unknown = { status: 'completed' }, shouldThrow = false) {
    return {
        execute: vi.fn(async () => {
            if (shouldThrow) throw new Error('AI execution failed');
            return result;
        }),
    };
}

/** Simulate a successful script execution via the mocked spawn */
function simulateScriptSuccess(output = '') {
    const child = makeFakeChild();
    mockSpawn.mockReturnValueOnce(child);
    setImmediate(() => {
        if (output) child.stdout.emit('data', Buffer.from(output));
        child.emit('close', 0);
    });
    return child;
}

/** Simulate a failed script execution via the mocked spawn */
function simulateScriptFailure(stderr = 'script error') {
    const child = makeFakeChild();
    mockSpawn.mockReturnValueOnce(child);
    setImmediate(() => {
        child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', 1);
    });
    return child;
}

// ============================================================================
// Tests
// ============================================================================

describe('WrappedTaskExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSpawn.mockReset();
    });

    // ========================================================================
    // Happy path
    // ========================================================================

    it('happy path: before → AI → after all succeed', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptSuccess('setup done');
        simulateScriptSuccess('cleanup done');

        const result = await executor.execute(task, 'test');

        expect(result).toEqual({ status: 'completed' });
        expect(inner.execute).toHaveBeenCalledWith(task, 'test');

        // Verify hook-step events: before-running, before-done, after-running, after-done
        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events).toHaveLength(4);
        expect(events[0][1].hookStep).toMatchObject({ step: 'before', status: 'running', script: './setup.sh' });
        expect(events[1][1].hookStep).toMatchObject({ step: 'before', status: 'done', script: './setup.sh' });
        expect(events[2][1].hookStep).toMatchObject({ step: 'after', status: 'running', script: './cleanup.sh' });
        expect(events[3][1].hookStep).toMatchObject({ step: 'after', status: 'done', script: './cleanup.sh' });
    });

    // ========================================================================
    // Before-script failure
    // ========================================================================

    it('before-script fails: AI skipped, after still runs, task throws', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptFailure('setup failed');
        simulateScriptSuccess('cleanup ok');

        await expect(executor.execute(task, 'test')).rejects.toThrow('Before-script failed');
        expect(inner.execute).not.toHaveBeenCalled();

        // After-script still ran
        const events = (store.emitProcessEvent as any).mock.calls;
        const afterEvents = events.filter((c: any) => c[1].hookStep?.step === 'after');
        expect(afterEvents).toHaveLength(2); // running + done
    });

    // ========================================================================
    // AI failure
    // ========================================================================

    it('AI fails: after-script still runs, task re-throws AI error', async () => {
        const inner = makeInnerExecutor(undefined, true);
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptSuccess('setup ok');
        simulateScriptSuccess('cleanup ok');

        await expect(executor.execute(task, 'test')).rejects.toThrow('AI execution failed');

        // After-script still ran
        const events = (store.emitProcessEvent as any).mock.calls;
        const afterEvents = events.filter((c: any) => c[1].hookStep?.step === 'after');
        expect(afterEvents).toHaveLength(2); // running + done
    });

    // ========================================================================
    // After-script failure
    // ========================================================================

    it('after-script fails: task completes but after-script emits failed event', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptFailure('cleanup error');

        // Task should still complete (after-script failure doesn't throw)
        const result = await executor.execute(task, 'test');
        expect(result).toEqual({ status: 'completed' });

        const events = (store.emitProcessEvent as any).mock.calls;
        const afterFailed = events.find((c: any) =>
            c[1].hookStep?.step === 'after' && c[1].hookStep?.status === 'failed'
        );
        expect(afterFailed).toBeDefined();
        expect(afterFailed[1].hookStep.output).toContain('cleanup error');
    });

    // ========================================================================
    // No scripts
    // ========================================================================

    it('no scripts: inner executor called directly', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask();

        const result = await executor.execute(task, 'test');

        expect(result).toEqual({ status: 'completed' });
        expect(inner.execute).toHaveBeenCalled();
        expect(store.emitProcessEvent).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Only before-script
    // ========================================================================

    it('only before-script: runs before then AI, no after events', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
            },
        });

        simulateScriptSuccess('ready');

        const result = await executor.execute(task, 'test');
        expect(result).toEqual({ status: 'completed' });

        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events).toHaveLength(2); // before-running + before-done
        expect(events.every((c: any) => c[1].hookStep.step === 'before')).toBe(true);
    });

    // ========================================================================
    // Only after-script
    // ========================================================================

    it('only after-script: AI runs then after, no before events', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptSuccess('done');

        const result = await executor.execute(task, 'test');
        expect(result).toEqual({ status: 'completed' });

        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events).toHaveLength(2); // after-running + after-done
        expect(events.every((c: any) => c[1].hookStep.step === 'after')).toBe(true);
    });

    // ========================================================================
    // Process ID
    // ========================================================================

    it('emits events with correct processId (queue_<taskId>)', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            id: 'abc-123',
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: 'echo hi',
            },
        });

        simulateScriptSuccess();

        await executor.execute(task, 'test');

        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events.every((c: any) => c[0] === 'queue_abc-123')).toBe(true);
    });

    // ========================================================================
    // Working directory
    // ========================================================================

    it('passes workingDirectory to spawn', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                workingDirectory: '/my/project',
            },
        });

        simulateScriptSuccess();

        await executor.execute(task, 'test');

        expect(mockSpawn).toHaveBeenCalledWith('./setup.sh', [], expect.objectContaining({
            shell: true,
            cwd: '/my/project',
        }));
    });

    // ========================================================================
    // Duration tracking
    // ========================================================================

    it('reports durationMs in done/failed events', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: 'echo hi',
            },
        });

        simulateScriptSuccess();

        await executor.execute(task, 'test');

        const events = (store.emitProcessEvent as any).mock.calls;
        const doneEvent = events.find((c: any) => c[1].hookStep?.status === 'done');
        expect(doneEvent[1].hookStep.durationMs).toBeTypeOf('number');
        expect(doneEvent[1].hookStep.durationMs).toBeGreaterThanOrEqual(0);
    });

    // ========================================================================
    // Post-actions: script type
    // ========================================================================

    describe('post-actions (script)', () => {
        it('runs script post-actions after AI task and after-script', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const executor = new WrappedTaskExecutor(inner, store);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    afterScript: './cleanup.sh',
                    postActions: [{ type: 'script', script: 'echo post' }],
                },
            });

            simulateScriptSuccess('cleanup ok');   // after-script
            simulateScriptSuccess('post output');  // post-action script

            const result = await executor.execute(task, 'test');
            expect(result).toEqual({ status: 'completed' });

            const events = (store.emitProcessEvent as any).mock.calls;
            // after-running, after-done, post-action-0-running, post-action-0-done
            const postEvents = events.filter((c: any) => c[1].hookStep?.step === 'post-action-0');
            expect(postEvents).toHaveLength(2);
            expect(postEvents[0][1].hookStep).toMatchObject({ step: 'post-action-0', status: 'running', script: 'echo post', actionType: 'script', index: 0 });
            expect(postEvents[1][1].hookStep).toMatchObject({ step: 'post-action-0', status: 'done', script: 'echo post', actionType: 'script', index: 0 });
            expect(postEvents[1][1].hookStep.output).toBe('post output');
        });

        it('runs multiple script post-actions sequentially', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const executor = new WrappedTaskExecutor(inner, store);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    postActions: [
                        { type: 'script', script: 'echo first' },
                        { type: 'script', script: 'echo second' },
                    ],
                },
            });

            simulateScriptSuccess('first out');
            simulateScriptSuccess('second out');

            await executor.execute(task, 'test');

            const events = (store.emitProcessEvent as any).mock.calls;
            const pa0 = events.filter((c: any) => c[1].hookStep?.step === 'post-action-0');
            const pa1 = events.filter((c: any) => c[1].hookStep?.step === 'post-action-1');
            expect(pa0).toHaveLength(2);
            expect(pa1).toHaveLength(2);
            expect(pa1[0][1].hookStep.index).toBe(1);
        });

        it('script post-action failure emits failed event but continues to next action', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const executor = new WrappedTaskExecutor(inner, store);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    postActions: [
                        { type: 'script', script: 'bad-script' },
                        { type: 'script', script: 'echo ok' },
                    ],
                },
            });

            simulateScriptFailure('script error');
            simulateScriptSuccess('ok output');

            const result = await executor.execute(task, 'test');
            expect(result).toEqual({ status: 'completed' });

            const events = (store.emitProcessEvent as any).mock.calls;
            const pa0Failed = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-0' && c[1].hookStep?.status === 'failed'
            );
            expect(pa0Failed).toBeDefined();
            expect(pa0Failed[1].hookStep.output).toContain('script error');

            const pa1Done = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-1' && c[1].hookStep?.status === 'done'
            );
            expect(pa1Done).toBeDefined();
        });

        it('post-actions run even when AI task fails', async () => {
            const inner = makeInnerExecutor(undefined, true);
            const executor = new WrappedTaskExecutor(inner, store);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    postActions: [{ type: 'script', script: 'echo post' }],
                },
            });

            simulateScriptSuccess('post output');

            await expect(executor.execute(task, 'test')).rejects.toThrow('AI execution failed');

            const events = (store.emitProcessEvent as any).mock.calls;
            const postDone = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-0' && c[1].hookStep?.status === 'done'
            );
            expect(postDone).toBeDefined();
        });

        it('no post-actions when array is empty', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const executor = new WrappedTaskExecutor(inner, store);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    postActions: [],
                },
            });

            const result = await executor.execute(task, 'test');
            expect(result).toEqual({ status: 'completed' });
            expect(store.emitProcessEvent).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Post-actions: skill type
    // ========================================================================

    describe('post-actions (skill)', () => {
        const mockExecuteSkill = vi.fn<(...args: any[]) => Promise<string>>();
        const mockResolveSkillConfig = vi.fn<(...args: any[]) => Promise<{ skillDirectories?: string[] }>>();

        beforeEach(() => {
            mockExecuteSkill.mockReset();
            mockResolveSkillConfig.mockReset();
        });

        it('runs skill post-action with task context and skill content', async () => {
            const inner = makeInnerExecutor({ status: 'completed', response: 'AI response' });
            // Mock resolveSkill — it's used for workspace-local resolution
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockResolvedValueOnce('# Skill Instructions\nDo something.');

            mockExecuteSkill.mockResolvedValueOnce('skill output');

            const executor = new WrappedTaskExecutor(inner, store, mockResolveSkillConfig, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test prompt',
                    workingDirectory: '/my/project',
                    postActions: [{ type: 'skill', skillName: 'my-skill', prompt: 'extra instructions' }],
                },
            });

            await executor.execute(task, 'test');

            expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
            const [sentPrompt, sentWd, sentModel] = mockExecuteSkill.mock.calls[0];
            expect(sentPrompt).toContain('<task-context>');
            expect(sentPrompt).toContain('<status>success</status>');
            expect(sentPrompt).toContain('<original-prompt>test prompt</original-prompt>');
            expect(sentPrompt).toContain('<skill name="my-skill">');
            expect(sentPrompt).toContain('extra instructions');
            expect(sentWd).toBe('/my/project');

            const events = (store.emitProcessEvent as any).mock.calls;
            const skillDone = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-0' && c[1].hookStep?.status === 'done'
            );
            expect(skillDone).toBeDefined();
            expect(skillDone[1].hookStep).toMatchObject({
                actionType: 'skill',
                skillName: 'my-skill',
                index: 0,
                output: 'skill output',
            });
        });

        it('skill post-action includes failed status when AI task fails', async () => {
            const inner = makeInnerExecutor(undefined, true);
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockResolvedValueOnce('# Skill content');
            mockExecuteSkill.mockResolvedValueOnce('skill output');

            const executor = new WrappedTaskExecutor(inner, store, mockResolveSkillConfig, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    workingDirectory: '/proj',
                    postActions: [{ type: 'skill', skillName: 'summarize' }],
                },
            });

            await expect(executor.execute(task, 'test')).rejects.toThrow('AI execution failed');

            const [sentPrompt] = mockExecuteSkill.mock.calls[0];
            expect(sentPrompt).toContain('<status>failed</status>');
            expect(sentPrompt).toContain('<error>AI execution failed</error>');
        });

        it('skill not found emits failed event and continues', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            const { SkillResolverError: SkillResolverErrorClass } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockRejectedValueOnce(new SkillResolverErrorClass('not found', 'SKILL_NOT_FOUND'));
            mockResolveSkillConfig.mockResolvedValueOnce({ skillDirectories: [] });

            const executor = new WrappedTaskExecutor(inner, store, mockResolveSkillConfig, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    workingDirectory: '/proj',
                    postActions: [
                        { type: 'skill', skillName: 'nonexistent' },
                        { type: 'script', script: 'echo ok' },
                    ],
                },
            });

            simulateScriptSuccess('ok');

            const result = await executor.execute(task, 'test');
            expect(result).toEqual({ status: 'completed' });

            const events = (store.emitProcessEvent as any).mock.calls;
            const skillFailed = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-0' && c[1].hookStep?.status === 'failed'
            );
            expect(skillFailed).toBeDefined();
            expect(skillFailed[1].hookStep.output).toContain('not found');

            // Second action still runs
            const pa1Done = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-1' && c[1].hookStep?.status === 'done'
            );
            expect(pa1Done).toBeDefined();
        });

        it('executeSkill not configured emits failed event', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            // No executeSkill callback
            const executor = new WrappedTaskExecutor(inner, store);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    postActions: [{ type: 'skill', skillName: 'my-skill' }],
                },
            });

            const result = await executor.execute(task, 'test');
            expect(result).toEqual({ status: 'completed' });

            const events = (store.emitProcessEvent as any).mock.calls;
            const skillFailed = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-0' && c[1].hookStep?.status === 'failed'
            );
            expect(skillFailed).toBeDefined();
            expect(skillFailed[1].hookStep.output).toContain('not configured');
        });

        it('executeSkill throwing emits failed event and continues', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockResolvedValueOnce('# Skill');
            mockExecuteSkill.mockRejectedValueOnce(new Error('AI service error'));

            const executor = new WrappedTaskExecutor(inner, store, mockResolveSkillConfig, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    workingDirectory: '/proj',
                    postActions: [{ type: 'skill', skillName: 'broken-skill' }],
                },
            });

            const result = await executor.execute(task, 'test');
            expect(result).toEqual({ status: 'completed' });

            const events = (store.emitProcessEvent as any).mock.calls;
            const skillFailed = events.find((c: any) =>
                c[1].hookStep?.step === 'post-action-0' && c[1].hookStep?.status === 'failed'
            );
            expect(skillFailed).toBeDefined();
            expect(skillFailed[1].hookStep.output).toContain('AI service error');
            expect(skillFailed[1].hookStep.durationMs).toBeTypeOf('number');
        });
    });

    // ========================================================================
    // Post-actions: mixed script + skill
    // ========================================================================

    describe('post-actions (mixed)', () => {
        it('runs mixed script and skill post-actions in order', async () => {
            const inner = makeInnerExecutor({ status: 'completed', response: 'done' });
            const mockExecuteSkill = vi.fn<(...args: any[]) => Promise<string>>().mockResolvedValueOnce('skill result');
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockResolvedValueOnce('# Skill content');

            const executor = new WrappedTaskExecutor(inner, store, undefined, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    workingDirectory: '/proj',
                    postActions: [
                        { type: 'script', script: 'echo first' },
                        { type: 'skill', skillName: 'my-skill' },
                    ],
                },
            });

            simulateScriptSuccess('first out');

            await executor.execute(task, 'test');

            const events = (store.emitProcessEvent as any).mock.calls;
            // post-action-0 is script, post-action-1 is skill
            const pa0 = events.filter((c: any) => c[1].hookStep?.step === 'post-action-0');
            const pa1 = events.filter((c: any) => c[1].hookStep?.step === 'post-action-1');
            expect(pa0[1][1].hookStep.actionType).toBe('script');
            expect(pa1[1][1].hookStep.actionType).toBe('skill');
            expect(pa1[1][1].hookStep.skillName).toBe('my-skill');
        });
    });

    // ========================================================================
    // buildTaskContext (via integration)
    // ========================================================================

    describe('buildTaskContext', () => {
        it('escapes XML special characters in prompt and response', async () => {
            const inner = makeInnerExecutor({ status: 'completed', response: 'result with <tags> & "quotes"' });
            const mockExecuteSkill = vi.fn<(...args: any[]) => Promise<string>>().mockResolvedValueOnce('ok');
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockResolvedValueOnce('# Skill');

            const executor = new WrappedTaskExecutor(inner, store, undefined, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'prompt with <special> & chars',
                    workingDirectory: '/proj',
                    postActions: [{ type: 'skill', skillName: 'test-skill' }],
                },
            });

            await executor.execute(task, 'test');

            const [sentPrompt] = mockExecuteSkill.mock.calls[0];
            expect(sentPrompt).toContain('&lt;special&gt;');
            expect(sentPrompt).toContain('&amp; chars');
            expect(sentPrompt).toContain('&lt;tags&gt;');
            // escapeXml only escapes &, <, > (text-content safe); quotes are not escaped
            expect(sentPrompt).toContain('&amp; "quotes"');
        });

        it('includes model and working-directory when present', async () => {
            const inner = makeInnerExecutor({ status: 'completed' });
            const mockExecuteSkill = vi.fn<(...args: any[]) => Promise<string>>().mockResolvedValueOnce('ok');
            const { resolveSkill: resolveSkillMock } = await import('@plusplusoneplusplus/forge');
            vi.mocked(resolveSkillMock).mockResolvedValueOnce('# Skill');

            const executor = new WrappedTaskExecutor(inner, store, undefined, mockExecuteSkill);
            const task = makeTask({
                payload: {
                    kind: 'chat', mode: 'autopilot', prompt: 'test',
                    model: 'gpt-5',
                    workingDirectory: '/my/dir',
                    postActions: [{ type: 'skill', skillName: 'test-skill' }],
                },
            });

            await executor.execute(task, 'test');

            const [sentPrompt] = mockExecuteSkill.mock.calls[0];
            expect(sentPrompt).toContain('<model>gpt-5</model>');
            expect(sentPrompt).toContain('<working-directory>/my/dir</working-directory>');
        });
    });
});
