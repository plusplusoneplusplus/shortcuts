import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamsBot } from '../../src/teams/bot';
import { TrouterClient, type TrouterWake } from '../../src/teams/trouter';
import { McpHttpError } from '../../src/teams/mcp/mcp-client';
import { GraphHttpError } from '../../src/teams/graph/graph-client';
import type { TeamsBotOptions } from '../../src/teams/types';

const token = `header.${Buffer.from(JSON.stringify({
    tid: '11111111-1111-4111-8111-111111111111', oid: '22222222-2222-4222-8222-222222222222',
})).toString('base64url')}.signature`;

describe('TeamsBot notification integration', () => {
    const bots: TeamsBot[] = [];
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.spyOn(TrouterClient.prototype, 'start').mockImplementation(() => {});
    });
    afterEach(async () => {
        await Promise.all(bots.splice(0).map(bot => bot.stop()));
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    function setup(overrides: Partial<TeamsBotOptions> = {}) {
        const message = vi.fn(async () => {});
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://example.test/mcp', teamId: 'team',
            enableTrouter: true, onMessage: message, auth: { bearerToken: token }, ...overrides,
        });
        const transport = {
            initialize: vi.fn(async () => {}), stop: vi.fn(), setChannelId: vi.fn(), setToken: vi.fn(),
            connectionId: 'connection', poll: vi.fn(async () => ({ messages: [], nextSince: 'baseline' })),
            send: vi.fn(async () => 'sent'),
            operations: {
                send: vi.fn(async () => ({ message: { messageId: 'sent' } })),
                reply: vi.fn(async () => ({ message: { messageId: 'sent' } })),
            },
        };
        (bot as any).transport = transport;
        bot.setChannelId('channel');
        bots.push(bot);
        const wake = (hint: TrouterWake = { cause: 'message' }) => (bot as any).trouter.options.onWake(hint);
        return { bot, transport, message, wake };
    }
    it('starts authoritative sync immediately; sends never restore short polling', async () => {
        const s = setup();
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(s.transport.poll).toHaveBeenCalledOnce();
        await s.bot.send('channel', 'outbound');
        await s.bot.sendMessage({ kind: 'channel', teamId: 'team', channelId: 'channel' }, { content: 'outbound', contentType: 'text' });
        await s.bot.replyToMessage({ destination: { kind: 'channel', teamId: 'team', channelId: 'channel' },
            messageId: 'root', connectionId: 'connection', backend: 'mcp' }, { content: 'outbound', contentType: 'text' });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(s.transport.poll).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(s.transport.poll).toHaveBeenCalledTimes(2);
    });
    it('admits all authoritative post-start roots and deduplicates notification repeats', async () => {
        const s = setup();
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(0);
        const roots = ['one', 'two'].map(messageId => ({ channelId: 'channel', messageId, text: 'question',
            createdDateTime: '2026-01-01T00:00:01Z' }));
        s.transport.poll.mockResolvedValue({ messages: roots as any, nextSince: 'two' });
        for (let i = 0; i < 10; i++) s.wake({ cause: 'message', rootMessageId: 'root' });
        await vi.advanceTimersByTimeAsync(0);
        expect(s.transport.poll).toHaveBeenCalledTimes(2);
        expect(s.transport.poll.mock.calls.at(-1)).toEqual(['channel', 'baseline',
            expect.objectContaining({ rootMessageIds: ['root'], reconcile: false })]);
        expect(s.message).toHaveBeenCalledTimes(2);
        s.wake();
        await vi.advanceTimersByTimeAsync(0);
        expect(s.message).toHaveBeenCalledTimes(2);
    });
    it('notification wakes before the startup watermark cannot dispatch historic roots', async () => {
        let resolve!: (value: any) => void;
        const s = setup();
        s.transport.poll.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(0);
        s.wake({ cause: 'message', rootMessageId: 'root' });
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.transport.poll).toHaveBeenCalledOnce();
        resolve({ messages: [{ channelId: 'channel', messageId: 'historic', text: 'old question',
            createdDateTime: '2025-12-31T23:59:59Z' }], nextSince: 'historic' });
        await vi.advanceTimersByTimeAsync(0);
        expect(s.message).not.toHaveBeenCalled();
        expect(s.transport.poll).toHaveBeenCalledTimes(2);
    });
    it('old admission loops cannot continue after stop and reconnect of the same bot', async () => {
        let release!: () => void;
        const s = setup();
        s.message.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
        s.transport.poll.mockResolvedValueOnce({ messages: ['first', 'second'].map(messageId => ({
            channelId: 'channel', messageId, text: 'question', createdDateTime: '2026-01-01T00:00:01Z',
        })) as any, nextSince: 'second' });
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(s.message).toHaveBeenCalledOnce();
        await s.bot.stop();
        await s.bot.start();
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(s.message).toHaveBeenCalledOnce();
        expect(s.bot.getStatus()).toBe('connected');
    });
    it.each([new McpHttpError(429, 'Limited', 90_000), new GraphHttpError(429, '90')])(
        'notifications cannot bypass reader HTTP429', async error => {
            const s = setup();
            s.transport.poll.mockRejectedValueOnce(error);
            await s.bot.start();
            await vi.advanceTimersByTimeAsync(0);
            s.wake({ cause: 'message-loss' });
            await vi.advanceTimersByTimeAsync(89_999);
            expect(s.transport.poll).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            expect(s.transport.poll).toHaveBeenCalledTimes(2);
        });
    it('keeps adaptive polling unchanged when off, without constructing ingress', async () => {
        const s = setup({ enableTrouter: false });
        await s.bot.start();
        expect(TrouterClient.prototype.start).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(11_999);
        expect(s.transport.poll).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(s.transport.poll).toHaveBeenCalledOnce();
        await s.bot.send('channel', 'outbound');
        await vi.advanceTimersByTimeAsync(12_000);
        expect(s.transport.poll).toHaveBeenCalledTimes(2);
        expect(s.transport.poll.mock.calls[0]).toEqual(['channel', undefined, undefined]);
    });
    it('stop cancels a pending read and prevents late admission/rearming', async () => {
        let resolve!: (value: any) => void;
        const s = setup();
        s.transport.poll.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(0);
        const hints = (s.transport.poll.mock.calls[0] as any)[2];
        await s.bot.stop();
        expect(hints.signal.aborted).toBe(true);
        resolve({ messages: [{ channelId: 'channel', messageId: 'late', text: 'question',
            createdDateTime: '2026-01-01T00:00:01Z' }], nextSince: 'late' });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(s.message).not.toHaveBeenCalled();
        expect(s.transport.poll).toHaveBeenCalledOnce();
    });
    it('missing reader identity fails closed before transport initialization', async () => {
        const s = setup({ auth: { bearerToken: 'opaque' } });
        await s.bot.start();
        expect(s.bot.getStatus()).toBe('error');
        expect(s.transport.initialize).not.toHaveBeenCalled();
        expect(TrouterClient.prototype.start).not.toHaveBeenCalled();
    });
    it('separate consumers do not wake or poll another selected conversation', async () => {
        const first = setup();
        const second = setup();
        second.bot.setChannelId('another-channel');
        await first.bot.start();
        await second.bot.start();
        await vi.advanceTimersByTimeAsync(0);
        first.wake({ cause: 'message', conversationId: 'channel', rootMessageId: 'root' });
        await vi.advanceTimersByTimeAsync(0);
        expect(first.transport.poll).toHaveBeenCalledTimes(2);
        expect(second.transport.poll).toHaveBeenCalledOnce();
        expect(second.transport.poll.mock.calls[0][0]).toBe('another-channel');
    });
    it('does not revive an initialization completed after shutdown', async () => {
        let resolve!: () => void;
        const s = setup();
        s.transport.initialize.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
        const starting = s.bot.start();
        await s.bot.stop();
        resolve();
        await starting;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(s.bot.getStatus()).toBe('disconnected');
        expect(s.transport.poll).not.toHaveBeenCalled();
        expect(TrouterClient.prototype.start).not.toHaveBeenCalled();
    });
    it('never probes a self-chat by posting when opted in without an explicit target', async () => {
        const s = setup({ teamId: undefined });
        (s.bot as any)._channelId = null;
        await s.bot.start();
        expect(s.bot.getStatus()).toBe('error');
        expect(s.transport.initialize).not.toHaveBeenCalled();
        expect(s.transport.send).not.toHaveBeenCalled();
    });
});
