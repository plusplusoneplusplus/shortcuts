import { describe, it, expect, beforeEach } from 'vitest';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { createMessagingChatModeResolver } from '../../../src/server/messaging/messaging-chat-mode';

describe('createMessagingChatModeResolver', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let tasks: Map<string, { status: string; payload: { mode?: string } }>;
    let resolve: ReturnType<typeof createMessagingChatModeResolver>;

    beforeEach(() => {
        store = createMockProcessStore();
        tasks = new Map();
        resolve = createMessagingChatModeResolver(store as any, { getTask: (id: string) => tasks.get(id) as any });
    });

    async function addChat(id: string, mode: string) {
        await store.addProcess({ id, status: 'completed', metadata: { type: 'chat', mode }, conversationTurns: [] } as any);
    }

    it('defaults a new chat to ask and honours an explicit mode', async () => {
        expect(await resolve(undefined)).toBe('ask');
        expect(await resolve(undefined, 'autopilot')).toBe('autopilot');
    });

    it('keeps an autopilot chat in autopilot for plain text (regression: follow-ups switched to ask)', async () => {
        await addChat('queue_a', 'autopilot');
        expect(await resolve('queue_a')).toBe('autopilot');
    });

    it('switches with an explicit /ask or /autopilot', async () => {
        await addChat('queue_a', 'autopilot');
        expect(await resolve('queue_a', 'ask')).toBe('ask');
        await addChat('queue_b', 'ask');
        expect(await resolve('queue_b', 'autopilot')).toBe('autopilot');
    });

    it('uses the queued first-turn mode before the process exists', async () => {
        tasks.set('t1', { status: 'queued', payload: { mode: 'autopilot' } });
        expect(await resolve('queue_t1')).toBe('autopilot');
        expect(await resolve('queue_t1', 'ask')).toBe('ask');
    });

    it('ignores the queued mode once the task is no longer queued', async () => {
        await addChat('queue_t1', 'ask');
        tasks.set('t1', { status: 'completed', payload: { mode: 'autopilot' } });
        expect(await resolve('queue_t1')).toBe('ask');
    });

    it('keeps a sentinel chat in sentinel', async () => {
        await addChat('queue_s', 'sentinel');
        expect(await resolve('queue_s', 'ask')).toBe('sentinel');
        expect(await resolve('queue_s')).toBe('sentinel');
    });
});
