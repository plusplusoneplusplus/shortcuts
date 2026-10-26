import { describe, it, expect, vi } from 'vitest';
import { BrowserHumanTakeover } from '../src/browser-human-takeover';
import { BrowserControlQueue, ControlDeadline } from '../src/browser-control-queue';
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const owner = { workspaceId: 'w', processId: 'p', turnId: 'turn', routingRef: 'clone:w' };
const make = () => new BrowserHumanTakeover(owner, vi.fn());

describe('conversation human takeover barrier', () => {
    it('blocks new input and observation, preserves validated pending work and leaves other conversations usable', async () => {
        const control = make();
        await control.take();
        const operation = vi.fn(async () => 'result');
        const validate = vi.fn(async () => {});
        const pending = control.run(operation, undefined, undefined, validate);
        await Promise.resolve();
        expect(operation).not.toHaveBeenCalled();
        expect(await make().run(async () => 'unrelated')).toBe('unrelated');
        await control.returnToAgent(async () => {}, 'signed in');
        expect(await pending).toBe('result');
        expect(validate).toHaveBeenCalledOnce();
        expect(control.note).toBe('signed in');
    });
    it('never resumes without target validation, and never replays an operation after dispatch', async () => {
        const gate = deferred<void>();
        const control = make();
        const operation = vi.fn(async () => { await gate.promise; return 'private late result'; });
        const active = control.run(operation).catch(error => error);
        await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
        const queued = vi.fn(async () => 'queued');
        const pending = control.run(queued).catch(error => error);
        const ready = control.take('Please complete MFA');
        expect((await active).message).toContain('unknown-outcome');
        expect(control.status).toBe('taking-over');
        gate.resolve(); await ready;
        expect(control.status).toBe('human');
        await control.returnToAgent(async () => {});
        expect((await pending).message).toContain('stale-action');
        expect(queued).not.toHaveBeenCalled();
        expect(operation).toHaveBeenCalledOnce();
    });
    it('waits for an issued press and its required release before human ownership', async () => {
        const down = deferred<unknown>();
        const send = vi.fn(async (_method: string, _params?: Record<string, unknown>): Promise<unknown> => ({})).mockImplementationOnce(() => down.promise);
        const queue = new BrowserControlQueue(send), control = make();
        const active = control.run(async signal => {
            try { await queue.run(page => page.press('Enter'), signal); }
            finally { await queue.settled(); }
        }).catch(error => error);
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const ready = control.take();
        expect((await active).message).toContain('unknown-outcome');
        expect(control.status).toBe('taking-over');
        down.resolve({}); await ready;
        expect(send.mock.calls.map(call => call[1]?.type)).toEqual(['keyDown', 'keyUp']);
        expect(control.status).toBe('human');
    });
    it('holds browser deadlines without timeout and composes with another deadline hold', async () => {
        vi.useFakeTimers();
        try {
            const expired = vi.fn(), deadline = new ControlDeadline(60_000, expired);
            const navigation = deadline.hold();
            const control = make(); await control.take();
            const pending = control.run(async () => 'okay', undefined, () => deadline.hold(), async () => {});
            await vi.advanceTimersByTimeAsync(600_000);
            expect(expired).not.toHaveBeenCalled();
            await control.returnToAgent(async () => {}); await pending;
            await vi.advanceTimersByTimeAsync(600_000);
            expect(expired).not.toHaveBeenCalled();
            navigation(); await vi.advanceTimersByTimeAsync(60_000);
            expect(expired).toHaveBeenCalledOnce(); deadline.clear();
        } finally { vi.useRealTimers(); }
    });
    it('retains human control after failed refresh and lets the person retry explicitly', async () => {
        const control = make(); await control.take();
        const operation = vi.fn(async () => 'safe');
        const pending = control.run(operation, undefined, undefined, async () => {});
        await expect(control.returnToAgent(async () => { throw new Error('gone'); })).rejects.toThrow('gone');
        expect(control.status).toBe('human'); expect(control.error).toContain('Retry'); expect(operation).not.toHaveBeenCalled();
        await control.returnToAgent(async () => {}); expect(await pending).toBe('safe');
    });
    it.each(['closed', 'disconnected', 'turn finished', 'flag disabled', 'Stop'])('terminates pending continuation on %s, including an in-flight refresh', async reason => {
        const control = make(); await control.take();
        const operation = vi.fn(); const pending = control.run(operation).catch(error => error);
        const gate = deferred<void>(); const refresh = control.returnToAgent(() => gate.promise).catch(error => error);
        await vi.waitFor(() => expect(control.status).toBe('checking'));
        control.stop(reason); gate.resolve();
        expect((await pending).message).toBe(reason); expect((await refresh).message).toBe(reason);
        await expect(control.run(operation)).rejects.toThrow(reason); expect(operation).not.toHaveBeenCalled();
    });
    it('cancels a command waiting for the person without returning control', async () => {
        const control = make(); await control.take();
        const controller = new AbortController(); const operation = vi.fn();
        const pending = control.run(operation, controller.signal).catch(error => error);
        controller.abort(new Error('cancelled'));
        expect((await pending).message).toBe('cancelled'); expect(control.paused).toBe(true); expect(operation).not.toHaveBeenCalled();
        control.stop();
    });
    it('permits only one explicit Return refresh and retains a later agent request reason', async () => {
        const control = make(); await control.take(); await control.take('Please sign in');
        expect(control.reason).toBe('Please sign in');
        const gate = deferred<void>(); const refresh = vi.fn(() => gate.promise);
        const first = control.returnToAgent(refresh);
        await expect(control.returnToAgent(refresh)).rejects.toThrow('not ready');
        gate.resolve(); await first; expect(refresh).toHaveBeenCalledOnce();
    });

});
