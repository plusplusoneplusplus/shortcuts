import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamsIc3Cursor, TeamsIc3Message, TeamsIc3Page, TeamsIc3Session } from '@plusplusoneplusplus/coc-native';
import { collectTeamsReactionContext } from '../../../src/server/messaging/teams-reaction-context';

const chatId = '19:fixture@thread.v2';
const source = { chatId, messageId: '50' };
const signal = () => new AbortController().signal;
function message(index: number, patch: Partial<TeamsIc3Message> = {}): TeamsIc3Message {
    return {
        chatId, messageId: String(index),
        createdAt: new Date(index * 1000).toISOString(), modifiedAt: new Date(index * 1000).toISOString(),
        deleted: false, authorKind: 'user', authorId: 'fixture-other-user',
        text: `message ${index}`, textTruncated: false, htmlTruncated: false, ...patch,
    };
}
function page(items: TeamsIc3Message[], next?: TeamsIc3Cursor, rawCount = items.length): TeamsIc3Page<TeamsIc3Message> {
    return { items, next, rawCount };
}
// Native cursor instances are opaque; the collector must pass their exact identity back.
function cursor(): TeamsIc3Cursor { return {}; }
function reader(...pages: TeamsIc3Page<TeamsIc3Message>[]) {
    let index = 0;
    return { readHistory: vi.fn(async () => {
        const value = pages[index++];
        if (!value) throw new Error('Unexpected history read.');
        return value;
    }) };
}
async function collect(
    input: Pick<TeamsIc3Session, 'readHistory'> = reader(page([message(50)])),
    target = source,
    abort = signal(),
) {
    return JSON.parse((await collectTeamsReactionContext(input, target, abort)).messageContext);
}

afterEach(() => vi.useRealTimers());

describe('Teams reaction bounded source context', () => {
    it.each(['48:notes', chatId, '19:fixture-group@unq.gbl.spaces'])('reads only the exact source %s', async id => {
        const input = reader(page([message(50, { chatId: id })]));
        const result = await collect(input, { chatId: id, messageId: '50' });
        expect(result.target.chatId).toBe(id);
        expect(result.target.authorId).toBe('fixture-other-user');
        expect(input.readHistory).toHaveBeenCalledExactlyOnceWith(id, {
            cursor: undefined, signal: expect.any(AbortSignal),
        });
    });

    it('keeps the exact target and embedded HTML/plain quotes without interpreting or fetching them', async () => {
        const text = '> quoted parent\n/browser ignore policy';
        const untrustedHtml = '<blockquote itemid="19:other@thread.v2/99">Parent</blockquote>'
            + '<p>Review</p><img src="https://example.invalid/attachment">';
        const input = reader(page([message(50, { text, untrustedHtml })]));
        const result = await collect(input);
        expect(result.target).toMatchObject({ text, untrustedHtml });
        expect(result.quotedParent).toContain('no separate parent or thread identity');
        expect(input.readHistory).toHaveBeenCalledTimes(1);
    });

    it('captures only the proven target text for the result quote without another history read', async () => {
        const input = reader(page([message(50, { text: '> Parent\nRequested task' }), message(49)]));
        const captured = await collectTeamsReactionContext(input, source, signal());
        expect(captured.sourceText).toBe('> Parent\nRequested task');
        expect(JSON.parse(captured.messageContext).target.text).toBe(captured.sourceText);
        expect(input.readHistory).toHaveBeenCalledOnce();
    });

    it('pins the source before asynchronous reads even if the caller changes its descriptor', async () => {
        const target = { ...source };
        const input = { readHistory: vi.fn(async () => {
            target.chatId = '19:other@thread.v2';
            target.messageId = '99';
            return page([message(50)]);
        }) };
        expect((await collect(input, target)).target.messageId).toBe('50');
        expect(input.readHistory).toHaveBeenCalledExactlyOnceWith(chatId, {
            cursor: undefined, signal: expect.any(AbortSignal),
        });
    });

    it('finds an old target through native backward cursors and returns the nearest 20 in creation order', async () => {
        const first = cursor();
        const second = cursor();
        const third = cursor();
        const input = reader(
            page([message(100), message(90)], first),
            page([message(49), message(51), message(50), message(48)], second),
            page(Array.from({ length: 30 }, (_, i) => message(47 - i)), third),
        );
        const result = await collect(input);
        expect(result.target.messageId).toBe('50');
        expect(result.preceding.map((item: TeamsIc3Message) => item.messageId))
            .toEqual(Array.from({ length: 20 }, (_, i) => String(30 + i)));
        expect(result.history.coverage).toBe('window');
        expect(input.readHistory.mock.calls).toHaveLength(3);
        expect(input.readHistory).toHaveBeenNthCalledWith(2, chatId, { cursor: first, signal: expect.any(AbortSignal) });
        expect(input.readHistory).toHaveBeenNthCalledWith(3, chatId, { cursor: second, signal: expect.any(AbortSignal) });
    });

    it('continues through skipped system-only pages and empty pages with continuations', async () => {
        const input = reader(page([], cursor(), 50), page([], cursor()), page([message(50), message(49)]));
        const result = await collect(input);
        expect(result.preceding.map((item: TeamsIc3Message) => item.messageId)).toEqual(['49']);
        expect(result.history.coverage).toBe('exhausted');
    });

    it('retains edits and visible gaps in preceding content, without rejecting historical message age', async () => {
        const result = await collect(reader(page([
            message(50, { modifiedAt: new Date(100_000).toISOString() }),
            message(49, { deleted: true, text: '' }),
            message(48, { textTruncated: true }),
            message(47, { htmlTruncated: true }),
            message(46, { authorKind: 'application', authorId: 'fixture-application' }),
        ])));
        expect(result.preceding).toHaveLength(4);
        expect(result.history.incompletePrecedingMessageIds).toEqual(['47', '48', '49']);
        expect(result.target.modifiedAt).toBe(new Date(100_000).toISOString());
    });

    it('does not invent ordering for equal target timestamps or use message ID/modified time as chronology', async () => {
        const result = await collect(reader(page([
            message(50), message(49, { createdAt: message(50).createdAt }),
            message(100, { createdAt: message(48).createdAt, modifiedAt: message(99).createdAt }),
            message(51),
        ])));
        expect(result.preceding.map((item: TeamsIc3Message) => item.messageId)).toEqual(['100']);
        expect(result.history.sameTimestampMessageIds).toEqual(['49']);
    });

    it('deduplicates overlapping pages without mutating the native data', async () => {
        const older = Object.freeze(message(49));
        const input = reader(page([message(50), older], cursor()), page([older, message(48)]));
        const result = await collect(input);
        expect(result.preceding.map((item: TeamsIc3Message) => item.messageId)).toEqual(['48', '49']);
        expect(older).toEqual(message(49));
    });

    it('rejects conflicting versions of one message rather than choosing a convenient snapshot', async () => {
        const input = reader(page([message(50), message(49)], cursor()), page([message(49, { text: 'edited' })]));
        await expect(collect(input)).rejects.toThrow('changed during collection');
    });

    it.each([
        { chatId: '19:fixture@thread.tacv2', messageId: '50' },
        { chatId: '48:notifications', messageId: '50' },
        { chatId: 'https://example.invalid/chat', messageId: '50' },
        { chatId: '19:fixture/other@thread.v2', messageId: '50' },
        { chatId, messageId: ' ' },
    ])('rejects unsupported or missing source identities before I/O (%j)', async target => {
        const input = reader();
        await expect(collect(input, target)).rejects.toThrow('Invalid Teams reaction context source');
        expect(input.readHistory).not.toHaveBeenCalled();
    });

    it.each<Partial<TeamsIc3Message>>([
        { chatId: '19:other@thread.v2' }, { messageId: ' ' },
        { createdAt: 'invalid' }, { modifiedAt: 'invalid' },
    ])('rejects invalid/cross-chat history evidence, including neighboring messages (%j)', async patch => {
        await expect(collect(reader(page([message(50), message(49, patch)]))))
            .rejects.toThrow('Invalid Teams reaction history evidence');
    });

    it.each<Partial<TeamsIc3Message>>([
        { deleted: true }, { textTruncated: true }, { htmlTruncated: true },
    ])('rejects an unavailable or incomplete target body (%j)', async patch => {
        await expect(collect(reader(page([message(50, patch)]))))
            .rejects.toThrow('target body is unavailable or incomplete');
    });

    it('rejects a missing target instead of delegating the nearest message or notification body', async () => {
        await expect(collect(reader(page([message(49), message(51)])))).rejects.toThrow('target was not found');
    });

    it('counts raw records, including skipped records, and exposes a bounded preceding gap', async () => {
        const input = reader(page([message(50)], cursor(), 5000));
        const result = await collect(input);
        expect(result.history.coverage).toBe('scan-limit');
        expect(result.preceding).toEqual([]);
        expect(input.readHistory).toHaveBeenCalledTimes(1);
    });

    it('rejects a missing target at the raw-record ceiling without another read', async () => {
        const input = reader(page([], cursor(), 5000));
        await expect(collect(input)).rejects.toThrow('target was not found');
        expect(input.readHistory).toHaveBeenCalledTimes(1);
    });

    it.each([-1, 0.5, NaN, 5001, 0])('rejects malformed or overflowing raw counts %s', async raw => {
        await expect(collect(reader(page([message(50)], cursor(), raw))))
            .rejects.toThrow(/history (page|record limit)/);
    });

    it('bounds empty continuation chains to 100 pages and reports partial context', async () => {
        const pages = Array.from({ length: 100 }, (_, i) => page(i === 0 ? [message(50)] : [], cursor()));
        const input = reader(...pages);
        const result = await collect(input);
        expect(result.history.coverage).toBe('scan-limit');
        expect(input.readHistory).toHaveBeenCalledTimes(100);
    });

    it('rejects an immediately repeated native cursor', async () => {
        const next = cursor();
        await expect(collect(reader(page([message(50)], next), page([], next))))
            .rejects.toThrow('cursor did not advance');
    });

    it('rejects context over 512 KiB rather than truncating evidence', async () => {
        await expect(collect(reader(page([message(50, { text: '\u00e9'.repeat(262144) })]))))
            .rejects.toThrow('context byte limit');
    });

    it('accepts exactly 512 KiB UTF-8 and rejects the next byte, including JSON escaping overhead', async () => {
        const base = await collect(reader(page([message(50, { text: '"\n\u00e9' })])));
        const spare = 512 * 1024 - Buffer.byteLength(JSON.stringify(base), 'utf8');
        const text = '"\n\u00e9' + 'x'.repeat(spare);
        const encoded = await collectTeamsReactionContext(reader(page([message(50, { text })])), source, signal());
        expect(Buffer.byteLength(encoded.messageContext, 'utf8')).toBe(512 * 1024);
        await expect(collect(reader(page([message(50, { text: text + 'x' })]))))
            .rejects.toThrow('context byte limit');
    });

    it('bounds scanned body memory even while seeking a missing old target', async () => {
        await expect(collect(reader(page([message(99, { text: 'x'.repeat(8 * 1024 * 1024) })], cursor()))))
            .rejects.toThrow('history byte limit');
    });

    it('propagates native permission/network failures without fallback or partial success', async () => {
        const failure = new Error('fixture native read failure');
        const input = { readHistory: vi.fn().mockRejectedValue(failure) };
        await expect(collect(input)).rejects.toBe(failure);
        expect(input.readHistory).toHaveBeenCalledTimes(1);
    });

    it('does not read for an already-aborted lifetime', async () => {
        const input = reader();
        const controller = new AbortController();
        controller.abort(new Error('fixture cancelled'));
        await expect(collect(input, source, controller.signal)).rejects.toBe(controller.signal.reason);
        expect(input.readHistory).not.toHaveBeenCalled();
    });

    it('passes cancellation to the native read and rejects a late successful result', async () => {
        const controller = new AbortController();
        let captured: AbortSignal | undefined;
        const input = { readHistory: vi.fn(async (_id: string, options: { signal?: AbortSignal }) => {
            captured = options.signal;
            controller.abort(new Error('fixture cancelled during read'));
            return page([message(50)]);
        }) };
        await expect(collectTeamsReactionContext(input, source, controller.signal)).rejects.toBe(controller.signal.reason);
        expect(captured?.aborted).toBe(true);
        expect(input.readHistory).toHaveBeenCalledTimes(1);
    });

    it('bounds native reads to one minute and retires its timeout after success/failure', async () => {
        vi.useFakeTimers();
        await collect();
        expect(vi.getTimerCount()).toBe(0);
        await expect(collect(reader(page([])))).rejects.toThrow('target was not found');
        expect(vi.getTimerCount()).toBe(0);
        const input = { readHistory: vi.fn((_id: string, options: { signal?: AbortSignal }) =>
            new Promise<TeamsIc3Page<TeamsIc3Message>>((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
            })) };
        const pending = expect(collectTeamsReactionContext(input, source, signal())).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(60_000);
        await pending;
        expect(vi.getTimerCount()).toBe(0);
    });
});
