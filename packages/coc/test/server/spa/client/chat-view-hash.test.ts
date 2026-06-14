import { describe, it, expect } from 'vitest';
import {
    readChatViewFromHash,
    applyChatViewToHash,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/chatViewHash';

const BASE = '#repos/ws-1/activity/task-9';

describe('readChatViewFromHash', () => {
    it('returns null when there is no query', () => {
        expect(readChatViewFromHash(BASE)).toBeNull();
        expect(readChatViewFromHash('')).toBeNull();
    });

    it('reads view=agents and view=thread', () => {
        expect(readChatViewFromHash(`${BASE}?view=agents`)).toBe('agents');
        expect(readChatViewFromHash(`${BASE}?view=thread`)).toBe('thread');
    });

    it('returns null for unknown or unrelated params', () => {
        expect(readChatViewFromHash(`${BASE}?view=bogus`)).toBeNull();
        expect(readChatViewFromHash(`${BASE}?mode=source`)).toBeNull();
    });

    it('reads view alongside other params', () => {
        expect(readChatViewFromHash(`${BASE}?mode=source&view=agents`)).toBe('agents');
    });
});

describe('applyChatViewToHash', () => {
    it('adds the param for the agents view', () => {
        expect(applyChatViewToHash(BASE, 'agents')).toBe(`${BASE}?view=agents`);
    });

    it('removes the param for the (default) thread view', () => {
        expect(applyChatViewToHash(`${BASE}?view=agents`, 'thread')).toBe(BASE);
    });

    it('is a no-op when thread view has no param', () => {
        expect(applyChatViewToHash(BASE, 'thread')).toBe(BASE);
    });

    it('preserves the path, leading #, and other query params', () => {
        expect(applyChatViewToHash(`${BASE}?mode=source`, 'agents')).toBe(`${BASE}?mode=source&view=agents`);
        expect(applyChatViewToHash(`${BASE}?mode=source&view=agents`, 'thread')).toBe(`${BASE}?mode=source`);
    });

    it('handles a hash with no leading #', () => {
        expect(applyChatViewToHash('repos/ws/activity/x', 'agents')).toBe('repos/ws/activity/x?view=agents');
    });

    it('round-trips with readChatViewFromHash', () => {
        const withAgents = applyChatViewToHash(BASE, 'agents');
        expect(readChatViewFromHash(withAgents)).toBe('agents');
        const backToThread = applyChatViewToHash(withAgents, 'thread');
        expect(readChatViewFromHash(backToThread)).toBeNull();
    });
});
