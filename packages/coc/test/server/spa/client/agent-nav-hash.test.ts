import { describe, it, expect } from 'vitest';
import {
    applyAgentNavToHash,
    readAgentNavFromHash,
    type AgentNav,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/agentNavHash';

const BASE = '#repos/ws-1/activity/task-9';

describe('readAgentNavFromHash', () => {
    it('defaults to the thread when no navigation params are present', () => {
        expect(readAgentNavFromHash(BASE)).toEqual({ kind: 'thread' });
        expect(readAgentNavFromHash('')).toEqual({ kind: 'thread' });
        expect(readAgentNavFromHash(`${BASE}?view=thread`)).toEqual({ kind: 'thread' });
        expect(readAgentNavFromHash(`${BASE}?view=bogus`)).toEqual({ kind: 'thread' });
    });

    it('reads legacy view=agents as the map', () => {
        expect(readAgentNavFromHash(`${BASE}?view=agents`)).toEqual({ kind: 'map' });
        expect(readAgentNavFromHash(`${BASE}?mode=source&view=agents`)).toEqual({ kind: 'map' });
    });

    it('reads legacy agent links and lets agent win over view', () => {
        expect(readAgentNavFromHash(`${BASE}?agent=tooluse_abc`)).toEqual({ kind: 'agent', id: 'tooluse_abc' });
        expect(readAgentNavFromHash(`${BASE}?view=agents&agent=tooluse_abc`)).toEqual({ kind: 'agent', id: 'tooluse_abc' });
    });
});

describe('applyAgentNavToHash', () => {
    it('removes agent navigation params for the thread', () => {
        expect(applyAgentNavToHash(`${BASE}?view=agents&agent=sub-1`, { kind: 'thread' })).toBe(BASE);
    });

    it('writes the map with legacy view=agents', () => {
        expect(applyAgentNavToHash(BASE, { kind: 'map' })).toBe(`${BASE}?view=agents`);
    });

    it('writes an agent id without keeping the map param', () => {
        expect(applyAgentNavToHash(`${BASE}?view=agents`, { kind: 'agent', id: 'sub-1' })).toBe(`${BASE}?agent=sub-1`);
    });

    it('preserves the path, leading hash, and unrelated params', () => {
        expect(applyAgentNavToHash(`${BASE}?mode=source`, { kind: 'map' })).toBe(`${BASE}?mode=source&view=agents`);
        expect(applyAgentNavToHash(`${BASE}?mode=source&agent=sub-1`, { kind: 'thread' })).toBe(`${BASE}?mode=source`);
        expect(applyAgentNavToHash('repos/ws/activity/x', { kind: 'map' })).toBe('repos/ws/activity/x?view=agents');
    });

    it('round-trips URL-encoded agent ids', () => {
        const nav: AgentNav = { kind: 'agent', id: 'tooluse_a/b+c' };
        expect(readAgentNavFromHash(applyAgentNavToHash(BASE, nav))).toEqual(nav);
    });
});
