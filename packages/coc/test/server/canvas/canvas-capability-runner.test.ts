import { describe, it, expect, vi } from 'vitest';
import {
    runCanvasCapability,
    isValidCapabilityName,
    getActiveCapabilityWorkerCount,
    ASYNC_CAPABILITY_TIMEOUT_MS,
    MAX_HOST_COMPLETIONS_PER_RUN,
    MAX_CONCURRENT_ASYNC_RUNS,
} from '../../../src/server/canvas/canvas-capability-runner';

/** Poll until the runner reports no live workers, or give up. */
async function waitForNoWorkers(timeoutMs = 5000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (getActiveCapabilityWorkerCount() > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    return getActiveCapabilityWorkerCount();
}

const KANBAN_CAPS = `
capabilities = {
    add_card: function (state, params) {
        var cards = (state.cards || []).slice();
        cards.push({ id: params.id, title: params.title, column: 'todo' });
        return Object.assign({}, state, { cards: cards });
    },
    move_card: function (state, params) {
        var cards = (state.cards || []).map(function (c) {
            return c.id === params.id ? Object.assign({}, c, { column: params.column }) : c;
        });
        return Object.assign({}, state, { cards: cards });
    },
};
`;

describe('runCanvasCapability', () => {
    it('applies a pure transform and returns the next state as JSON', async () => {
        const result = await runCanvasCapability(KANBAN_CAPS, 'add_card', '{"cards":[]}', { id: 'a', title: 'First' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            const state = JSON.parse(result.state);
            expect(state.cards).toEqual([{ id: 'a', title: 'First', column: 'todo' }]);
        }
    });

    it('treats empty state as {}', async () => {
        const result = await runCanvasCapability(KANBAN_CAPS, 'add_card', '', { id: 'x', title: 'X' });
        expect(result.ok).toBe(true);
        if (result.ok) expect(JSON.parse(result.state).cards).toHaveLength(1);
    });

    it('rejects an unknown capability and lists the available ones', async () => {
        const result = await runCanvasCapability(KANBAN_CAPS, 'delete_card', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Unknown capability');
            expect(result.error).toContain('add_card');
        }
    });

    it('rejects an invalid capability name without executing the script', async () => {
        const result = await runCanvasCapability(KANBAN_CAPS, 'DROP TABLE', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('Invalid capability name');
    });

    it('rejects non-JSON canvas state', async () => {
        const result = await runCanvasCapability(KANBAN_CAPS, 'add_card', 'not json', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('not valid JSON');
    });

    it('reports a script that fails to assign capabilities', async () => {
        const result = await runCanvasCapability('var x = 1;', 'add_card', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('capabilities');
    });

    it('reports a script that throws while loading', async () => {
        const result = await runCanvasCapability('throw new Error("boom");', 'add_card', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('failed to load');
    });

    it('reports a capability that throws', async () => {
        const caps = `capabilities = { boom: function () { throw new Error("nope"); } };`;
        const result = await runCanvasCapability(caps, 'boom', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('threw');
    });

    it('rejects a capability that returns a non-object', async () => {
        const caps = `capabilities = { bad: function () { return 42; } };`;
        const result = await runCanvasCapability(caps, 'bad', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('complete next state object');
    });

    it('enforces a wall-clock timeout on infinite loops', async () => {
        const caps = `capabilities = { spin: function () { while (true) {} } };`;
        const result = await runCanvasCapability(caps, 'spin', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.toLowerCase()).toContain('time');
    });

    it('isolates the sandbox from host globals (no process/require)', async () => {
        const caps = `capabilities = {
            probe: function (state) {
                return {
                    hasProcess: typeof process !== 'undefined',
                    hasRequire: typeof require !== 'undefined',
                };
            },
        };`;
        const result = await runCanvasCapability(caps, 'probe', '{}', {});
        expect(result.ok).toBe(true);
        if (result.ok) {
            const state = JSON.parse(result.state);
            expect(state.hasProcess).toBe(false);
            expect(state.hasRequire).toBe(false);
        }
    });

    it('rejects a result that exceeds the state size cap', async () => {
        const caps = `capabilities = { grow: function () { return { big: 'x'.repeat(2 * 1024 * 1024) }; } };`;
        const result = await runCanvasCapability(caps, 'grow', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('1 MB');
    });
});

describe('runCanvasCapability — async path', () => {
    it('defaults the async budget to 30 seconds', () => {
        expect(ASYNC_CAPABILITY_TIMEOUT_MS).toBe(30_000);
    });

    it('resolves a capability that awaits, and leaves no worker behind', async () => {
        const caps = `
            capabilities = {
                slow: async function (state, params) {
                    await new Promise(function (r) { setTimeout(r, 20); });
                    return Object.assign({}, state, { done: params.value });
                },
            };
        `;
        const result = await runCanvasCapability(caps, 'slow', '{"n":1}', { value: 'yes' }, { async: true });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(JSON.parse(result.state)).toEqual({ n: 1, done: 'yes' });
        }
        expect(await waitForNoWorkers()).toBe(0);
    });

    it('routes host.complete to the injected implementation', async () => {
        const caps = `
            capabilities = {
                ask: async function (state, params, host) {
                    const answer = await host.complete('What is ' + params.q + '?');
                    return { answer: answer };
                },
            };
        `;
        const complete = vi.fn(async () => ({ ok: true as const, text: 'forty two' }));
        const result = await runCanvasCapability(caps, 'ask', '{}', { q: '6x7' }, { async: true, complete });
        expect(result.ok).toBe(true);
        if (result.ok) expect(JSON.parse(result.state)).toEqual({ answer: 'forty two' });
        expect(complete).toHaveBeenCalledWith({ prompt: 'What is 6x7?' });
    });

    it('forwards a caller-chosen model to the completion implementation', async () => {
        const caps = `
            capabilities = {
                ask: async function (state, params, host) {
                    return { answer: await host.complete('hi', { model: 'claude-opus-5' }) };
                },
            };
        `;
        const complete = vi.fn(async () => ({ ok: true as const, text: 'ok' }));
        await runCanvasCapability(caps, 'ask', '{}', {}, { async: true, complete });
        expect(complete).toHaveBeenCalledWith({ prompt: 'hi', model: 'claude-opus-5' });
    });

    it(`caps host.complete at ${MAX_HOST_COMPLETIONS_PER_RUN} calls per run`, async () => {
        const caps = `
            capabilities = {
                spam: async function (state, params, host) {
                    const results = [];
                    for (var i = 0; i < 6; i++) {
                        try { results.push(await host.complete('ask ' + i)); }
                        catch (err) { results.push('ERR:' + err.code); }
                    }
                    return { results: results };
                },
            };
        `;
        const complete = vi.fn(async () => ({ ok: true as const, text: 'ok' }));
        const result = await runCanvasCapability(caps, 'spam', '{}', {}, { async: true, complete });
        expect(result.ok).toBe(true);
        if (result.ok) {
            const { results } = JSON.parse(result.state) as { results: string[] };
            expect(results.filter(r => r === 'ok')).toHaveLength(MAX_HOST_COMPLETIONS_PER_RUN);
            expect(results.filter(r => r === 'ERR:quota')).toHaveLength(6 - MAX_HOST_COMPLETIONS_PER_RUN);
        }
        expect(complete).toHaveBeenCalledTimes(MAX_HOST_COMPLETIONS_PER_RUN);
    });

    it("rejects host.complete with code 'offline' when no implementation is supplied", async () => {
        const caps = `
            capabilities = {
                ask: async function (state, params, host) {
                    try { await host.complete('hello'); return { code: 'none' }; }
                    catch (err) { return { code: err.code, message: err.message }; }
                },
            };
        `;
        const result = await runCanvasCapability(caps, 'ask', '{}', {}, { async: true });
        expect(result.ok).toBe(true);
        if (result.ok) expect(JSON.parse(result.state).code).toBe('offline');
    });

    it('surfaces a failed completion to the capability instead of hanging', async () => {
        const caps = `
            capabilities = {
                ask: async function (state, params, host) {
                    try { await host.complete('hello'); return { code: 'none' }; }
                    catch (err) { return { code: err.code, message: err.message }; }
                },
            };
        `;
        const result = await runCanvasCapability(caps, 'ask', '{}', {}, {
            async: true,
            complete: async () => ({ ok: false as const, error: 'model exploded' }),
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(JSON.parse(result.state).message).toBe('model exploded');
    });

    it('terminates a capability that never resolves, and the worker is gone afterwards', async () => {
        const caps = `capabilities = { hang: function () { return new Promise(function () {}); } };`;
        const result = await runCanvasCapability(caps, 'hang', '{}', {}, { async: true, timeoutMs: 300 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('was terminated');
        expect(await waitForNoWorkers()).toBe(0);
    });

    it('terminates a capability spinning in a synchronous loop', async () => {
        const caps = `capabilities = { spin: async function () { while (true) {} } };`;
        const result = await runCanvasCapability(caps, 'spin', '{}', {}, { async: true, timeoutMs: 300 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('was terminated');
        expect(await waitForNoWorkers()).toBe(0);
    });

    it('does not leak a capability that resolves and then keeps spinning', async () => {
        // Resolves immediately, then burns the thread forever. The result must
        // come back AND the worker must not outlive the run.
        const caps = `
            capabilities = {
                sneaky: async function (state) {
                    setTimeout(function () { while (true) {} }, 0);
                    return { ok: true };
                },
            };
        `;
        const result = await runCanvasCapability(caps, 'sneaky', '{}', {}, { async: true, timeoutMs: 5000 });
        expect(result.ok).toBe(true);
        expect(getActiveCapabilityWorkerCount()).toBe(0);
    });

    it('reports an async capability that throws', async () => {
        const caps = `capabilities = { boom: async function () { throw new Error('nope'); } };`;
        const result = await runCanvasCapability(caps, 'boom', '{}', {}, { async: true });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('nope');
        expect(await waitForNoWorkers()).toBe(0);
    });

    it('rejects an async capability that resolves to a non-object', async () => {
        const caps = `capabilities = { bad: async function () { return 42; } };`;
        const result = await runCanvasCapability(caps, 'bad', '{}', {}, { async: true });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('complete next state object');
    });

    it('reports an unknown async capability without starting the run', async () => {
        const caps = `capabilities = { only: async function () { return {}; } };`;
        const result = await runCanvasCapability(caps, 'missing', '{}', {}, { async: true });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('Unknown capability');
    });

    it('gives the async capability no require and no process either', async () => {
        const caps = `
            capabilities = {
                probe: async function () {
                    return {
                        hasProcess: typeof process !== 'undefined',
                        hasRequire: typeof require !== 'undefined',
                        hasHost: typeof host !== 'undefined',
                        hasFetch: typeof fetch !== 'undefined',
                    };
                },
            };
        `;
        const result = await runCanvasCapability(caps, 'probe', '{}', {}, { async: true });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(JSON.parse(result.state)).toEqual({
                hasProcess: false,
                hasRequire: false,
                hasHost: true,
                hasFetch: false,
            });
        }
    });

    it(`never runs more than ${MAX_CONCURRENT_ASYNC_RUNS} workers at once`, async () => {
        const caps = `
            capabilities = {
                slow: async function (state) {
                    await new Promise(function (r) { setTimeout(r, 150); });
                    return { done: true };
                },
            };
        `;
        let peak = 0;
        const sampler = setInterval(() => {
            peak = Math.max(peak, getActiveCapabilityWorkerCount());
        }, 10);
        const results = await Promise.all(
            Array.from({ length: MAX_CONCURRENT_ASYNC_RUNS + 4 }, () =>
                runCanvasCapability(caps, 'slow', '{}', {}, { async: true })),
        );
        clearInterval(sampler);

        expect(results.every(r => r.ok)).toBe(true);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_ASYNC_RUNS);
        expect(await waitForNoWorkers()).toBe(0);
    }, 20_000);
});

describe('isValidCapabilityName', () => {
    it('accepts lowercase_snake_case names', () => {
        expect(isValidCapabilityName('add_card')).toBe(true);
        expect(isValidCapabilityName('move')).toBe(true);
        expect(isValidCapabilityName('a1_b2')).toBe(true);
    });

    it('rejects malformed names', () => {
        expect(isValidCapabilityName('AddCard')).toBe(false);
        expect(isValidCapabilityName('1card')).toBe(false);
        expect(isValidCapabilityName('add-card')).toBe(false);
        expect(isValidCapabilityName('')).toBe(false);
    });
});
