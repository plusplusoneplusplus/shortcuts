import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3DirectMessageClient, Ic3ReactionClient, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { MicrosoftTokenProvider } from '@plusplusoneplusplus/coc-native';
import { formatTeamsReactionNotice, sendTeamsReactionReply, sendTeamsReactionResult, type TeamsReactionNotice, type TeamsReactionResult }
    from '../../../src/server/messaging/teams-reaction-reply';
import type { TeamsIc3CommandSource } from '../../../src/server/messaging/teams-ic3-own-command-reply';

const notice: TeamsReactionNotice = {
    sourceText: 'Please review this request.',
    result: { kind: 'approval', outcome: 'rejected' },
};

describe('compact Teams reaction result formatting', () => {
    it.each([
        [{ kind: 'task', outcome: 'done' }, 'Task done.'],
        [{ kind: 'task', outcome: 'rejected' }, 'Task rejected.'],
        [{ kind: 'approval', outcome: 'done' }, 'PR approval done.'],
        [{ kind: 'approval', outcome: 'rejected' }, 'PR approval rejected.'],
    ] satisfies [TeamsReactionResult, string][])('uses an explicit %j result without AI prose', (result, sentence) => {
        const html = formatTeamsReactionNotice({ ...notice, result });
        expect(html).toBe(`<blockquote><p>Please review this request.</p></blockquote>`
            + `<p>CoC \u00b7 ${sentence}</p>`);
        expect(html).not.toMatch(/<a\b|href=|chat-references|Open job|see job/);
        expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(512);
    });

    it('does not claim a new approval submission for a done result', () => {
        const html = formatTeamsReactionNotice({ ...notice, result: { kind: 'approval', outcome: 'done' } });
        expect(html).toContain('PR approval done.');
        expect(html).not.toMatch(/submitted|unverified|could not be verified/);
    });

    it('escapes source text literally rather than rendering HTML, Markdown, mentions or links', () => {
        const html = formatTeamsReactionNotice({
            ...notice, sourceText: '@coc <at id="0">Someone</at> & **approve** [approve](https://other.example.test)',
        });
        expect(html).toContain('@coc &lt;at id=&quot;0&quot;&gt;Someone&lt;/at&gt; &amp; **approve**');
        expect(html).not.toMatch(/<at|<strong|href="https:\/\/other/);
        expect(html).not.toContain('<a ');
    });

    it('collapses lines into one bounded source excerpt without forwarding the full findings', () => {
        const html = formatTeamsReactionNotice({ ...notice, sourceText: ` \n first\tline\r\n${'a'.repeat(3000)}` });
        const excerpt = html.match(/<blockquote><p>(.*?)<\/p><\/blockquote>/)![1];
        expect(excerpt).toBe(`first line ${'a'.repeat(109)}...`);
        expect(html).not.toContain('\n');
        expect(html).not.toContain('a'.repeat(110));
    });

    it.each([119, 120, 121])('bounds %s Unicode code points without splitting surrogate pairs', count => {
        const character = '\u{1f916}';
        const html = formatTeamsReactionNotice({ ...notice, sourceText: character.repeat(count) });
        const excerpt = html.match(/<blockquote><p>(.*?)<\/p><\/blockquote>/)![1];
        expect(excerpt).toBe(character.repeat(Math.min(120, count)) + (count > 120 ? '...' : ''));
        expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(1024);
    });

    it('bounds the worst-case escaped excerpt', () => {
        const html = formatTeamsReactionNotice({ ...notice, sourceText: '"'.repeat(10_000) });
        expect(html).toContain('&quot;'.repeat(120) + '...');
        expect(Buffer.byteLength(html, 'utf8')).toBeLessThanOrEqual(4096);
    });

    it.each(['', '  \r\n\t'])('quotes messages without text without reading attachments', sourceText => {
        expect(formatTeamsReactionNotice({ ...notice, sourceText })).toContain('<p>(Message without text)</p>');
    });

    it.each([
        undefined, null, {}, { kind: 'completed', outcome: 'approved' }, { kind: '__proto__', outcome: 'approved' },
        { kind: 'task', outcome: 'approved' }, { kind: 'approval', outcome: 'completed' },
        { kind: 'approval', outcome: 'toString' }, { kind: 'approval', outcome: 'PR approved.' },
    ])('rejects missing, ambiguous or forged outcome categories (%j)', result => {
        // Exercise malformed runtime data without weakening the public discriminated union.
        const invalid = JSON.parse(JSON.stringify({ ...notice, result }));
        expect(() => formatTeamsReactionNotice(invalid)).toThrow('Invalid Teams reaction result');
    });

    it('rejects non-text runtime source data', () => {
        expect(() => formatTeamsReactionNotice(JSON.parse(JSON.stringify({ ...notice, sourceText: {} }))))
            .toThrow('Invalid Teams reaction source text');
    });
});

describe('Teams reaction result source delivery', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const source: TeamsIc3CommandSource = {
        account: { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' },
        chatId: '19:fixture@thread.v2', region: 'amer', verifyAccess: vi.fn(async () => {}),
    };

    beforeEach(() => {
        vi.mocked(source.verifyAccess).mockReset().mockResolvedValue(undefined);
        fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ OriginalArrivalTime: '12345' }), { status: 201 }));
        vi.stubGlobal('fetch', fetch);
        const accessToken = 'header.' + Buffer.from(JSON.stringify({
            aud: 'https://ic3.teams.office.com', tid: source.account.tenantId, oid: source.account.userId,
            exp: Math.floor(Date.now() / 1000) + 3600, name: 'Fixture User',
        })).toString('base64url') + '.signature';
        vi.spyOn(MicrosoftTokenProvider.prototype, 'getToken').mockResolvedValue({
            accessToken, tokenType: 'Bearer', expiresAt: Math.floor(Date.now() / 1000) + 3600,
            source: 'azure-cli', target: 'https://ic3.teams.office.com',
            account: { id: 'fixture-account', tenant: source.account.tenantId },
        });
    });

    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

    it.each(['48:notes', '19:fixture@thread.v2', '19:fixture@unq.gbl.spaces'])(
        'sends exactly one source quote and outcome to %s with pinned access', async chatId => {
            const dispose = vi.spyOn(Ic3DirectMessageClient.prototype, 'dispose');
            await sendTeamsReactionReply({ ...source, chatId }, notice, new AbortController().signal);
            expect(fetch).toHaveBeenCalledOnce();
            const [url, init] = fetch.mock.calls[0];
            expect(url).toBe(`https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`);
            const body = JSON.parse(String(init?.body));
            expect(body.conversationid).toBe(chatId);
            expect(body.content).toBe(formatTeamsReactionNotice(notice));
            expect(body.messagetype).toBe('RichText/Html');
            expect(body.content).not.toContain('Part 1/');
            expect(source.verifyAccess).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
            expect(dispose).toHaveBeenCalledOnce();
        },
    );

    it('does not acquire credentials or send if the result is invalid', async () => {
        const invalid = JSON.parse(JSON.stringify({ ...notice, result: {} }));
        await expect(sendTeamsReactionReply(source, invalid, new AbortController().signal)).rejects.toThrow();
        expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not authenticate or send after cancellation', async () => {
        const controller = new AbortController();
        controller.abort(new Error('Revoked source'));
        await expect(sendTeamsReactionReply(source, notice, controller.signal)).rejects.toThrow('Revoked source');
        expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('propagates revoked access without delivery', async () => {
        vi.mocked(source.verifyAccess).mockRejectedValueOnce(new Error('Revoked'));
        await expect(sendTeamsReactionReply(source, notice, new AbortController().signal)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('preserves account pinning rather than sending as a changed signed-in user', async () => {
        const token = 'header.' + Buffer.from(JSON.stringify({
            aud: 'https://ic3.teams.office.com', tid: source.account.tenantId, oid: source.account.tenantId,
            exp: Math.floor(Date.now() / 1000) + 3600,
        })).toString('base64url') + '.signature';
        vi.mocked(MicrosoftTokenProvider.prototype.getToken).mockResolvedValueOnce({
            accessToken: token, tokenType: 'Bearer', expiresAt: Math.floor(Date.now() / 1000) + 3600,
            source: 'azure-cli', target: 'https://ic3.teams.office.com',
        });
        await expect(sendTeamsReactionReply(source, notice, new AbortController().signal)).rejects.toMatchObject({ code: 'authentication' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('shares definitive-failure refresh and source revalidation without relaunching work', async () => {
        vi.useFakeTimers();
        fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const sending = sendTeamsReactionReply(source, notice, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(source.verifyAccess).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).content))
            .toEqual([formatTeamsReactionNotice(notice), formatTeamsReactionNotice(notice)]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retains the exact source and access check across asynchronous retries', async () => {
        vi.useFakeTimers();
        const captured = { ...source };
        const verifyAccess = captured.verifyAccess;
        fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const sending = sendTeamsReactionReply(captured, notice, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(0);
        captured.chatId = '19:other@thread.v2';
        captured.region = 'emea';
        captured.verifyAccess = vi.fn(async () => { throw new Error('Retargeted'); });
        captured.account = { tenantId: source.account.userId, userId: source.account.tenantId };
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(fetch).toHaveBeenCalledTimes(2);
        for (const [url, init] of fetch.mock.calls) {
            expect(String(url)).toContain('/amer/');
            expect(JSON.parse(String(init?.body)).conversationid).toBe(source.chatId);
        }
        expect(verifyAccess).toHaveBeenCalledTimes(2);
        expect(captured.verifyAccess).not.toHaveBeenCalled();
    });

    it('never retries an unknown delivery outcome or adds an outcome reaction', async () => {
        const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockRejectedValueOnce(
            new TeamsOperationError('Unknown', 'ic3', 'timeout', 'unknown', undefined, true));
        await expect(sendTeamsReactionReply(source, notice, new AbortController().signal)).rejects.toThrow();
        expect(send).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('disposes the sender on an uncertain network failure without replay', async () => {
        const dispose = vi.spyOn(Ic3DirectMessageClient.prototype, 'dispose');
        fetch.mockRejectedValueOnce(new Error('Private failure'));
        await expect(sendTeamsReactionReply(source, notice, new AbortController().signal))
            .rejects.toMatchObject({ backend: 'ic3', outcome: 'unknown' });
        expect(fetch).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it.each([
        [{ kind: 'task', outcome: 'done' }, '2714_heavycheckmark'],
        [{ kind: 'task', outcome: 'rejected' }, '274c_crossmark'],
        [{ kind: 'approval', outcome: 'done' }, '2714_heavycheckmark'],
        [{ kind: 'approval', outcome: 'rejected' }, '274c_crossmark'],
    ] satisfies [TeamsReactionResult, string][])(
        'delivers %j with its dispatcher outcome reaction', async (result, key) => {
            const dispose = vi.spyOn(Ic3ReactionClient.prototype, 'dispose');
            await sendTeamsReactionResult({ ...source, messageId: 'target-fixture' }, { ...notice, result },
                new AbortController().signal);
            const rejected = result.outcome === 'rejected';
            expect(fetch).toHaveBeenCalledTimes(rejected ? 2 : 1);
            if (rejected) {
                const [url, init] = fetch.mock.calls[0];
                expect(String(url)).toContain('/messages');
                expect(init?.method).toBe('POST');
                expect(JSON.parse(String(init?.body)).content).toBe(formatTeamsReactionNotice({ ...notice, result }));
            } else {
                expect(fetch.mock.calls.every(([, init]) => init?.method === 'PUT')).toBe(true);
            }
            const [reactionUrl, reactionInit] = fetch.mock.calls[rejected ? 1 : 0];
            expect(String(reactionUrl)).toBe('https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/'
                + `${encodeURIComponent(source.chatId)}/messages/target-fixture/properties?name=emotions`);
            expect(reactionInit?.method).toBe('PUT');
            expect(JSON.parse(String(reactionInit?.body))).toEqual({ emotions: { key, value: expect.any(Number) } });
            expect(source.verifyAccess).toHaveBeenCalledTimes(rejected ? 2 : 1);
            expect(dispose).toHaveBeenCalledOnce();
        },
    );

    it.each(['48:notes', '19:fixture@thread.v2', '19:fixture@unq.gbl.spaces'])(
        'reacts to the exact source message in %s without replacing unrelated reactions', async chatId => {
            await sendTeamsReactionResult({ ...source, chatId, messageId: 'foreign-authored-target' }, notice,
                new AbortController().signal);
            const [url, init] = fetch.mock.calls[1];
            expect(String(url)).toContain(`/conversations/${encodeURIComponent(chatId)}/messages/foreign-authored-target/`);
            expect(JSON.parse(String(init?.body)).emotions).toEqual({ key: '274c_crossmark', value: expect.any(Number) });
            expect(fetch.mock.calls.every(([, request]) => request?.method !== 'DELETE')).toBe(true);
        },
    );

    it.each(['', ' ', '../other', 'target?query', 'target#fragment', 'a'.repeat(4097)])(
        'rejects invalid result targets before sending a notice (%s)', async messageId => {
            await expect(sendTeamsReactionResult({ ...source, messageId }, notice, new AbortController().signal))
                .rejects.toThrow('Invalid Teams reaction result target');
            expect(fetch).not.toHaveBeenCalled();
            expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
        },
    );

    it('validates the full notice before any outcome write', async () => {
        const invalid = JSON.parse(JSON.stringify({ ...notice, result: {} }));
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, invalid,
            new AbortController().signal)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
        expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
    });

    it.each([{ messageId: null }, { messageId: 123 }, { messageId: {} }, { messageId: ['target'] }])(
        'rejects non-text runtime targets before delivery (%j)', async ({ messageId }) => {
        const invalid = JSON.parse(JSON.stringify({ ...source, messageId }));
        await expect(sendTeamsReactionResult(invalid, notice, new AbortController().signal))
            .rejects.toThrow('Invalid Teams reaction result target');
        expect(fetch).not.toHaveBeenCalled();
        expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
    });

    it('captures outcome, message, account, region and access method before asynchronous delivery', async () => {
        const mutableSource = { ...source, account: { ...source.account }, messageId: 'original-target' };
        const mutableNotice: TeamsReactionNotice = { ...notice, result: { kind: 'approval', outcome: 'done' } };
        const replacementAccess = vi.fn(async () => {});
        vi.mocked(source.verifyAccess).mockImplementationOnce(async () => {
            mutableSource.chatId = '19:other@thread.v2';
            mutableSource.messageId = 'other-target';
            mutableSource.region = 'emea';
            mutableSource.account.userId = source.account.tenantId;
            mutableSource.verifyAccess = replacementAccess;
            mutableNotice.result = { kind: 'approval', outcome: 'rejected' };
        });
        await sendTeamsReactionResult(mutableSource, mutableNotice, new AbortController().signal);
        const [url, init] = fetch.mock.calls[0];
        expect(String(url)).toContain(`/amer/v1/users/ME/conversations/${encodeURIComponent(source.chatId)}/messages/original-target/`);
        expect(JSON.parse(String(init?.body)).emotions.key).toBe('2714_heavycheckmark');
        expect(source.verifyAccess).toHaveBeenCalledOnce();
        expect(replacementAccess).not.toHaveBeenCalled();
    });

    it.each(['not-attempted', 'rejected', 'unknown'] as const)(
        'surfaces a %s done reaction failure without a text fallback or retry', async outcome => {
            const error = new TeamsOperationError('Reaction failed', 'ic3', 'network', outcome);
            const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage').mockRejectedValueOnce(error);
            const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat');
            await expect(sendTeamsReactionResult({ ...source, messageId: 'target' },
                { ...notice, result: { kind: 'task', outcome: 'done' } }, new AbortController().signal)).rejects.toBe(error);
            expect(react).toHaveBeenCalledOnce();
            expect(send).not.toHaveBeenCalled();
        },
    );

    it('does not send or react when done source access is revoked', async () => {
        vi.mocked(source.verifyAccess).mockRejectedValueOnce(new Error('Access revoked'));
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' },
            { ...notice, result: { kind: 'approval', outcome: 'done' } }, new AbortController().signal))
            .rejects.toThrow('Access revoked');
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['not-attempted', 'unknown'] as const)('never reacts or retries result delivery after a %s notice failure', async outcome => {
        const error = new TeamsOperationError('Notice failed', 'ic3', 'network', outcome);
        const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockRejectedValueOnce(error);
        const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage');
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, new AbortController().signal))
            .rejects.toBe(error);
        expect(send).toHaveBeenCalledOnce();
        expect(react).not.toHaveBeenCalled();
    });

    it.each(['not-attempted', 'rejected', 'unknown'] as const)('surfaces a %s reaction failure without replaying the notice or reaction', async outcome => {
        const error = new TeamsOperationError('Reaction failed', 'ic3', 'network', outcome);
        const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage').mockRejectedValueOnce(error);
        const dispose = vi.spyOn(Ic3ReactionClient.prototype, 'dispose');
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, new AbortController().signal))
            .rejects.toBe(error);
        expect(fetch).toHaveBeenCalledOnce();
        expect(react).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('keeps the delivered notice but refuses the reaction when source access is revoked', async () => {
        vi.mocked(source.verifyAccess).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Access revoked'));
        const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage');
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, new AbortController().signal))
            .rejects.toThrow('Access revoked');
        expect(fetch).toHaveBeenCalledOnce();
        expect(react).not.toHaveBeenCalled();
    });

    it('does not send or react when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort(new Error('Stopped result'));
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, controller.signal))
            .rejects.toThrow('Stopped result');
        expect(fetch).not.toHaveBeenCalled();
        expect(source.verifyAccess).not.toHaveBeenCalled();
    });

    it('does not react after cancellation during notice delivery', async () => {
        const controller = new AbortController();
        vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockImplementationOnce(async () => {
            controller.abort(new Error('Stopped result'));
            return 'notice-fixture';
        });
        const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage');
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, controller.signal))
            .rejects.toThrow('Stopped result');
        expect(react).not.toHaveBeenCalled();
    });

    it('does not react after cancellation during source revalidation', async () => {
        const controller = new AbortController();
        vi.mocked(source.verifyAccess).mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
            controller.abort(new Error('Stopped result'));
        });
        const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage');
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, controller.signal))
            .rejects.toThrow('Stopped result');
        expect(fetch).toHaveBeenCalledOnce();
        expect(react).not.toHaveBeenCalled();
    });

    it('rejects late reaction success after cancellation and disposes its client', async () => {
        const controller = new AbortController();
        vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage').mockImplementationOnce(async () => {
            controller.abort(new Error('Stopped result'));
        });
        const dispose = vi.spyOn(Ic3ReactionClient.prototype, 'dispose');
        await expect(sendTeamsReactionResult({ ...source, messageId: 'target' }, notice, controller.signal))
            .rejects.toThrow('Stopped result');
        expect(fetch).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
