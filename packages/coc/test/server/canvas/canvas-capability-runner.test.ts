import { describe, it, expect } from 'vitest';
import { runCanvasCapability, isValidCapabilityName } from '../../../src/server/canvas/canvas-capability-runner';

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
    it('applies a pure transform and returns the next state as JSON', () => {
        const result = runCanvasCapability(KANBAN_CAPS, 'add_card', '{"cards":[]}', { id: 'a', title: 'First' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            const state = JSON.parse(result.state);
            expect(state.cards).toEqual([{ id: 'a', title: 'First', column: 'todo' }]);
        }
    });

    it('treats empty state as {}', () => {
        const result = runCanvasCapability(KANBAN_CAPS, 'add_card', '', { id: 'x', title: 'X' });
        expect(result.ok).toBe(true);
        if (result.ok) expect(JSON.parse(result.state).cards).toHaveLength(1);
    });

    it('rejects an unknown capability and lists the available ones', () => {
        const result = runCanvasCapability(KANBAN_CAPS, 'delete_card', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Unknown capability');
            expect(result.error).toContain('add_card');
        }
    });

    it('rejects an invalid capability name without executing the script', () => {
        const result = runCanvasCapability(KANBAN_CAPS, 'DROP TABLE', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('Invalid capability name');
    });

    it('rejects non-JSON canvas state', () => {
        const result = runCanvasCapability(KANBAN_CAPS, 'add_card', 'not json', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('not valid JSON');
    });

    it('reports a script that fails to assign capabilities', () => {
        const result = runCanvasCapability('var x = 1;', 'add_card', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('capabilities');
    });

    it('reports a script that throws while loading', () => {
        const result = runCanvasCapability('throw new Error("boom");', 'add_card', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('failed to load');
    });

    it('reports a capability that throws', () => {
        const caps = `capabilities = { boom: function () { throw new Error("nope"); } };`;
        const result = runCanvasCapability(caps, 'boom', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('threw');
    });

    it('rejects a capability that returns a non-object', () => {
        const caps = `capabilities = { bad: function () { return 42; } };`;
        const result = runCanvasCapability(caps, 'bad', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('complete next state object');
    });

    it('enforces a wall-clock timeout on infinite loops', () => {
        const caps = `capabilities = { spin: function () { while (true) {} } };`;
        const result = runCanvasCapability(caps, 'spin', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.toLowerCase()).toContain('time');
    });

    it('isolates the sandbox from host globals (no process/require)', () => {
        const caps = `capabilities = {
            probe: function (state) {
                return {
                    hasProcess: typeof process !== 'undefined',
                    hasRequire: typeof require !== 'undefined',
                };
            },
        };`;
        const result = runCanvasCapability(caps, 'probe', '{}', {});
        expect(result.ok).toBe(true);
        if (result.ok) {
            const state = JSON.parse(result.state);
            expect(state.hasProcess).toBe(false);
            expect(state.hasRequire).toBe(false);
        }
    });

    it('rejects a result that exceeds the state size cap', () => {
        const caps = `capabilities = { grow: function () { return { big: 'x'.repeat(2 * 1024 * 1024) }; } };`;
        const result = runCanvasCapability(caps, 'grow', '{}', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('1 MB');
    });
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
