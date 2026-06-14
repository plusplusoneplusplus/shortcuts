/**
 * Unit tests for the MCP per-tool allow-list write logic (AC-03).
 */

import { describe, it, expect } from 'vitest';
import {
    isMcpToolEnabled,
    toggleMcpToolEntry,
    applyMcpToolToggle,
    enableAllMcpTools,
    disableAllMcpTools,
    normalizeEnabledMcpTools,
} from '../../../../../src/server/spa/client/react/features/skills/mcpToolsAllowList';

describe('isMcpToolEnabled', () => {
    it('treats a missing entry as all-enabled', () => {
        expect(isMcpToolEnabled(undefined, 'anything')).toBe(true);
    });

    it('enables only listed tools when an entry exists', () => {
        expect(isMcpToolEnabled(['a', 'b'], 'a')).toBe(true);
        expect(isMcpToolEnabled(['a', 'b'], 'c')).toBe(false);
    });

    it('disables every tool for an empty entry', () => {
        expect(isMcpToolEnabled([], 'a')).toBe(false);
    });
});

describe('toggleMcpToolEntry', () => {
    const discovered = ['read', 'write', 'delete'];

    it('returns undefined when turning on a tool with no entry (no-op)', () => {
        expect(toggleMcpToolEntry(undefined, discovered, 'read', true)).toBeUndefined();
    });

    it('materializes the complement on the first toggle-off', () => {
        expect(toggleMcpToolEntry(undefined, discovered, 'delete', false)).toEqual(['read', 'write']);
    });

    it('removes a tool from an existing entry on toggle-off', () => {
        expect(toggleMcpToolEntry(['read', 'write'], discovered, 'write', false)).toEqual(['read']);
    });

    it('adds a tool to an existing entry on toggle-on', () => {
        expect(toggleMcpToolEntry(['read'], discovered, 'write', true)).toEqual(['read', 'write']);
    });

    it('does not duplicate an already-enabled tool', () => {
        expect(toggleMcpToolEntry(['read'], discovered, 'read', true)).toEqual(['read']);
    });
});

describe('applyMcpToolToggle', () => {
    it('materializes a new server entry on first toggle-off', () => {
        const next = applyMcpToolToggle({}, 'srv', ['a', 'b', 'c'], 'b', false);
        expect(next).toEqual({ srv: ['a', 'c'] });
    });

    it('drops the entry when a tool is re-enabled into a no-op', () => {
        // entry undefined + enable → undefined → key deleted (stays absent)
        const next = applyMcpToolToggle({ other: ['x'] }, 'srv', ['a'], 'a', true);
        expect(next).toEqual({ other: ['x'] });
        expect('srv' in next).toBe(false);
    });

    it('does not mutate the input map', () => {
        const input = { srv: ['a', 'b'] };
        const next = applyMcpToolToggle(input, 'srv', ['a', 'b'], 'a', false);
        expect(input).toEqual({ srv: ['a', 'b'] });
        expect(next).toEqual({ srv: ['b'] });
    });

    it('keeps a server entry as an empty list when its last tool is disabled', () => {
        const next = applyMcpToolToggle({ srv: ['a'] }, 'srv', ['a'], 'a', false);
        expect(next).toEqual({ srv: [] });
    });
});

describe('enableAllMcpTools / disableAllMcpTools', () => {
    it('enableAll removes the server entry', () => {
        expect(enableAllMcpTools({ srv: ['a'], other: ['x'] }, 'srv')).toEqual({ other: ['x'] });
    });

    it('disableAll sets an empty list', () => {
        expect(disableAllMcpTools({ other: ['x'] }, 'srv')).toEqual({ other: ['x'], srv: [] });
    });
});

describe('normalizeEnabledMcpTools', () => {
    it('returns null for an empty map', () => {
        expect(normalizeEnabledMcpTools({})).toBeNull();
    });

    it('returns the map when it has entries', () => {
        expect(normalizeEnabledMcpTools({ srv: [] })).toEqual({ srv: [] });
    });
});

describe('round-trip: toggle off then back on materializes then keeps an entry', () => {
    it('newly discovered tools default off once an entry exists', () => {
        // Start with no entry (all on), disable one tool → entry materialized.
        let map = applyMcpToolToggle({}, 'srv', ['a', 'b'], 'b', false);
        expect(map).toEqual({ srv: ['a'] });
        // A newly discovered tool 'c' is NOT in the entry → disabled by default.
        expect(isMcpToolEnabled(map.srv, 'c')).toBe(false);
        // Re-enable 'b' → entry now ['a','b'] but 'c' still off (entry persists).
        map = applyMcpToolToggle(map, 'srv', ['a', 'b', 'c'], 'b', true);
        expect(map).toEqual({ srv: ['a', 'b'] });
        expect(isMcpToolEnabled(map.srv, 'c')).toBe(false);
    });
});
