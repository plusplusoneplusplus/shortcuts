import { describe, it, expect } from 'vitest';
import {
    readAgentFromHash,
    applyAgentToHash,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/chatAgentHash';
import {
    readChatViewFromHash,
    applyChatViewToHash,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/chatViewHash';

const BASE = '#repos/ws-1/activity/task-9';

describe('readAgentFromHash', () => {
    it('returns null when there is no query or no agent param', () => {
        expect(readAgentFromHash(BASE)).toBeNull();
        expect(readAgentFromHash('')).toBeNull();
        expect(readAgentFromHash(`${BASE}?view=agents`)).toBeNull();
    });

    it('reads the agent id', () => {
        expect(readAgentFromHash(`${BASE}?agent=tooluse_abc`)).toBe('tooluse_abc');
    });

    it('reads the agent id alongside view and other params', () => {
        expect(readAgentFromHash(`${BASE}?view=agents&agent=tooluse_abc`)).toBe('tooluse_abc');
        expect(readAgentFromHash(`${BASE}?mode=source&agent=x1`)).toBe('x1');
    });

    it('round-trips a URL-encoded id', () => {
        const id = 'tooluse_a/b+c';
        expect(readAgentFromHash(applyAgentToHash(BASE, id))).toBe(id);
    });
});

describe('applyAgentToHash', () => {
    it('adds the agent param', () => {
        expect(applyAgentToHash(BASE, 'sub-1')).toBe(`${BASE}?agent=sub-1`);
    });

    it('removes the agent param when null', () => {
        expect(applyAgentToHash(`${BASE}?agent=sub-1`, null)).toBe(BASE);
    });

    it('is a no-op when clearing an absent param', () => {
        expect(applyAgentToHash(BASE, null)).toBe(BASE);
    });

    it('preserves the path, leading #, and other params (incl. view)', () => {
        expect(applyAgentToHash(`${BASE}?view=agents`, 'sub-1')).toBe(`${BASE}?view=agents&agent=sub-1`);
        expect(applyAgentToHash(`${BASE}?view=agents&agent=sub-1`, null)).toBe(`${BASE}?view=agents`);
    });

    it('handles a hash with no leading #', () => {
        expect(applyAgentToHash('repos/ws/activity/x', 'sub-1')).toBe('repos/ws/activity/x?agent=sub-1');
    });
});

describe('agent + view params coexist', () => {
    it('both round-trip through their own readers', () => {
        const both = applyAgentToHash(applyChatViewToHash(BASE, 'agents'), 'sub-9');
        expect(readChatViewFromHash(both)).toBe('agents');
        expect(readAgentFromHash(both)).toBe('sub-9');
    });

    it('clearing the agent leaves view intact', () => {
        const both = applyAgentToHash(applyChatViewToHash(BASE, 'agents'), 'sub-9');
        const cleared = applyAgentToHash(both, null);
        expect(readChatViewFromHash(cleared)).toBe('agents');
        expect(readAgentFromHash(cleared)).toBeNull();
    });
});
