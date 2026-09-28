import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamsBot } from '../../src/teams/bot';
import type { InboundTeamsMessage } from '../../src/teams/types';

describe('TeamsBot safe poll observers', () => {
    afterEach(() => vi.useRealTimers());

    it('reports failed and recovered polls, observed messages and skips without changing delivery', async () => {
        vi.useFakeTimers();
        const delivered = vi.fn().mockResolvedValue(undefined);
        const onPoll = vi.fn();
        const onInbound = vi.fn();
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://example.test/mcp',
            onMessage: delivered, onPoll, onInbound,
        });
        bot.setChannelId('channel');
        const message = (messageId: string, text: string): InboundTeamsMessage =>
            ({ channelId: 'channel', messageId, text });
        const poll = vi.fn()
            .mockRejectedValueOnce(new Error('private transport response'))
            .mockResolvedValueOnce({ messages: [message('first', 'old')], nextSince: 'first' })
            .mockResolvedValueOnce({ messages: [message('first', 'old')], nextSince: 'first' })
            .mockResolvedValueOnce({ messages: [message('second', '   ')], nextSince: 'second' })
            .mockResolvedValueOnce({ messages: [message('third', 'Bot\nAgent: bot\nRepo: repo\nMessage:\nbody')], nextSince: 'third' })
            .mockResolvedValueOnce({ messages: [message('fourth', 'own')], nextSince: 'fourth' })
            .mockResolvedValueOnce({ messages: [message('fifth', 'new')], nextSince: 'fifth' });
        (bot as unknown as { transport: { poll: typeof poll; stop: () => void } }).transport =
            { poll, stop: vi.fn() };
        (bot as unknown as { _sentMessageIds: Set<string> })._sentMessageIds.add('fourth');
        (bot as unknown as { _status: string })._status = 'connected';
        for (let i = 0; i < 7; i++) {
            await (bot as unknown as { pollMessages: () => Promise<void> }).pollMessages();
        }
        expect(onPoll.mock.calls).toEqual([['failure'], ...Array.from({ length: 6 }, () => ['success'])]);
        expect(onInbound.mock.calls).toEqual([
            ['skipped', 'initial'], ['skipped', 'unchanged'], ['skipped', 'empty'],
            ['skipped', 'bot'], ['skipped', 'own'], ['observed', undefined],
        ]);
        expect(delivered).toHaveBeenCalledOnce();
        expect(delivered.mock.calls[0][0]).toMatchObject({ messageId: 'fifth' });
        expect(bot.getStatus()).toBe('connected');
        await bot.stop();
    });

    it('ignores observer exceptions so delivery and polling continue', async () => {
        vi.useFakeTimers();
        const delivered = vi.fn().mockResolvedValue(undefined);
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://example.test/mcp',
            onMessage: delivered,
            onPoll: () => { throw new Error('observer failure'); },
            onInbound: () => { throw new Error('observer failure'); },
        });
        bot.setChannelId('channel');
        const poll = vi.fn()
            .mockResolvedValueOnce({ messages: [{ channelId: 'channel', messageId: 'first', text: 'old' }], nextSince: 'first' })
            .mockResolvedValueOnce({ messages: [{ channelId: 'channel', messageId: 'second', text: 'new' }], nextSince: 'second' });
        (bot as unknown as { transport: { poll: typeof poll; stop: () => void } }).transport =
            { poll, stop: vi.fn() };
        (bot as unknown as { _status: string })._status = 'connected';
        await (bot as unknown as { pollMessages: () => Promise<void> }).pollMessages();
        await (bot as unknown as { pollMessages: () => Promise<void> }).pollMessages();
        expect(delivered).toHaveBeenCalledOnce();
        await bot.stop();
    });
});
