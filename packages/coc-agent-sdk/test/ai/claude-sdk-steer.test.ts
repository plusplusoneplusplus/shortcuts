/**
 * ClaudeSDKService — mid-turn steering.
 *
 * `steerSession()` pushes a user message (priority `'next'`) into the live
 * streaming-input gate of a running turn, and refuses once the turn has a
 * terminal signal or has ended so the caller queues the message instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';
import { resetSDKLogger } from '../../src/logger';

const mockDynamicImport = vi.mocked(dynamicImportModule);

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const SESSION = 'sess-steer';
const assistantText = (text: string) => ({ type: 'assistant', session_id: SESSION, message: { content: [{ type: 'text', text }] } });
const resultMsg = () => ({ type: 'result', subtype: 'success', session_id: SESSION });
const taskStarted = (taskId: string) => ({ type: 'system', subtype: 'task_started', task_id: taskId, task_type: 'local_bash' });
const taskNotification = (taskId: string) => ({ type: 'system', subtype: 'task_notification', task_id: taskId, status: 'completed' });

/**
 * Fake `query()`: records every streamed input message, yields `pre`, waits
 * for `release()`, then yields `post`.
 */
function makeFake(pre: object[], post: object[]) {
    const recordedInput: unknown[] = [];
    const reachedPause = deferred();
    const gate = deferred();
    const queryFn = vi.fn((callOptions: { prompt: AsyncIterable<unknown> }) => {
        void (async () => {
            for await (const msg of callOptions.prompt) recordedInput.push(msg);
        })();
        return {
            [Symbol.asyncIterator]() {
                return (async function* () {
                    for (const m of pre) yield m;
                    reachedPause.resolve();
                    await gate.promise;
                    for (const m of post) yield m;
                })();
            },
            return: async (v?: unknown) => ({ done: true as const, value: v }),
        };
    });
    return { queryFn, recordedInput, whenPaused: () => reachedPause.promise, release: gate.resolve };
}

describe('ClaudeSDKService steering', () => {
    let svc: ClaudeSDKService;

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
    });

    afterEach(() => {
        resetSDKLogger();
        svc.dispose();
    });

    it('pushes a steer into the running turn with priority "next"', async () => {
        const fake = makeFake([assistantText('working')], [assistantText(' done'), resultMsg()]);
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'start' });
        await fake.whenPaused();
        await flush();

        await expect(svc.steerSession(SESSION, 'also check the tests')).resolves.toBe(true);
        await flush();
        expect(fake.recordedInput).toEqual([
            { type: 'user', message: { role: 'user', content: 'start' }, parent_tool_use_id: null },
            { type: 'user', message: { role: 'user', content: 'also check the tests' }, parent_tool_use_id: null, priority: 'next' },
        ]);

        fake.release();
        const result = await sendP;
        expect(result.success).toBe(true);
        expect(result.response).toBe('working done');
    });

    it('refuses to steer once the turn has ended', async () => {
        const fake = makeFake([assistantText('hi'), resultMsg()], []);
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'start' });
        fake.release();
        await sendP;

        await expect(svc.steerSession(SESSION, 'too late')).resolves.toBe(false);
    });

    it('refuses to steer after a terminal result while background work holds the turn open', async () => {
        const fake = makeFake(
            [assistantText('started'), taskStarted('bg1'), resultMsg()],
            [taskNotification('bg1'), { type: 'system', subtype: 'session_state_changed', state: 'idle' }],
        );
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'start' });
        await fake.whenPaused();
        await flush();

        await expect(svc.steerSession(SESSION, 'after result')).resolves.toBe(false);
        expect(fake.recordedInput).toHaveLength(1);

        fake.release();
        await sendP;
    });

    it('returns false for an unknown session', async () => {
        await expect(svc.steerSession('no-such-session', 'hello')).resolves.toBe(false);
    });
});
