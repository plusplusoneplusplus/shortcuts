import { describe, it, expect } from 'vitest';
import {
    compareChatRecency,
    getChatRowTitle,
    getChatSelectionId,
    isSentinelChat,
    selectLatestSentinelChat,
} from '../../../../src/server/spa/client/react/features/chat/latestSentinelChat';

const sn = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'chat', payload: { mode: 'sentinel' }, ...extra });

describe('latestSentinelChat', () => {
    it('identifies Sentinel chats only', () => {
        expect(isSentinelChat(sn('a'))).toBe(true);
        expect(isSentinelChat({ id: 'b', type: 'chat', mode: 'sentinel' })).toBe(true);
        expect(isSentinelChat({ id: 'c', type: 'chat', payload: { mode: 'autopilot' } })).toBe(false);
        expect(isSentinelChat(sn('d', { workItemId: 'w1' }))).toBe(false);
        expect(isSentinelChat({ ...sn('e'), type: 'run-script' })).toBe(false);
        expect(isSentinelChat(null)).toBe(false);
    });

    it('orders by the chat list convention (completedAt || startedAt || createdAt, newest first)', () => {
        const rows = [
            { id: 'a', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'b', startedAt: '2026-01-03T00:00:00Z' },
            { id: 'c', completedAt: '2026-01-02T00:00:00Z', startedAt: '2026-01-05T00:00:00Z' },
        ];
        expect([...rows].sort(compareChatRecency).map(r => r.id)).toEqual(['b', 'c', 'a']);
    });

    it('selects the newest Sentinel among running and completed chats', () => {
        const latest = selectLatestSentinelChat(
            [{ id: 'auto', type: 'chat', startedAt: '2026-02-09T00:00:00Z' }, sn('run', { startedAt: '2026-02-02T00:00:00Z' })],
            [sn('done', { completedAt: '2026-02-05T00:00:00Z' }), sn('older', { completedAt: '2026-02-01T00:00:00Z' })],
        );
        expect(latest?.id).toBe('done');
    });

    it('returns null when there is no eligible chat', () => {
        expect(selectLatestSentinelChat([], [])).toBeNull();
        expect(selectLatestSentinelChat([{ id: 'x', type: 'chat' }], [])).toBeNull();
        expect(selectLatestSentinelChat([], [sn('arch')], new Set(['arch']))).toBeNull();
    });

    it('skips archived chats and falls back to the next newest', () => {
        const latest = selectLatestSentinelChat(
            [],
            [sn('new', { completedAt: '2026-02-05T00:00:00Z' }), sn('old', { completedAt: '2026-02-01T00:00:00Z' })],
            new Set(['new']),
        );
        expect(latest?.id).toBe('old');
    });

    it('prefers the running row when the same process also appears in history', () => {
        const running = sn('q1', { processId: 'p1', status: 'running', startedAt: '2026-02-01T00:00:00Z' });
        const history = sn('p1', { processId: 'p1', status: 'completed', completedAt: '2026-02-01T00:00:00Z' });
        expect(selectLatestSentinelChat([running], [history])).toBe(running);
    });

    it('derives titles and selection ids like the chat list', () => {
        expect(getChatRowTitle(sn('a', { customTitle: 'Custom', title: 'AI' }))).toBe('Custom');
        expect(getChatRowTitle(sn('a', { title: 'AI', lastMessagePreview: 'msg' }))).toBe('AI');
        expect(getChatRowTitle(sn('a', { prompt: 'Watch the build' }))).toBe('Watch the build');
        expect(getChatRowTitle(sn('a'))).toBe('Chat');
        expect(getChatSelectionId({ id: 'q1', processId: 'p1' })).toBe('p1');
        expect(getChatSelectionId({ id: 'queue_q1' })).toBe('queue_q1');
    });
});
