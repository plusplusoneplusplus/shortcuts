import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3DirectMessageClient, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { AuthError, MicrosoftTokenProvider, NativeTeamsError } from '@plusplusoneplusplus/coc-native';
import { sendTeamsIc3OwnCommandReply, type TeamsIc3OwnCommandSource } from '../../../src/server/messaging/teams-ic3-own-command-reply';
import { admitTeamsIc3OwnCommand } from '../../../src/server/messaging/teams-ic3-own-command-admission';

const source: TeamsIc3OwnCommandSource = {
    account: { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' },
    chatId: '19:fixture@thread.v2', region: 'amer', verifyAccess: vi.fn(async () => {}),
    replyTo: { messageId: '1790000000000', text: '@coc explain this' },
};
const id = 'ic3-command-fixture';

describe('IC3 command reply through existing Teams clients', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
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

    it('refreshes authentication and rechecks the source after a definitive HTTP 401', async () => {
        vi.useFakeTimers();
        const clear = vi.spyOn(Ic3DirectMessageClient.prototype, 'clearCredential');
        fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(MicrosoftTokenProvider.prototype.getToken).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MicrosoftTokenProvider.prototype.getToken).mock.calls[1][0]).toMatchObject({ forceRefresh: true });
        expect(source.verifyAccess).toHaveBeenCalledTimes(2);
        expect(clear).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries a transient credential failure without repeating the Ask job', async () => {
        vi.useFakeTimers();
        vi.mocked(MicrosoftTokenProvider.prototype.getToken).mockRejectedValueOnce(new AuthError('TimedOut'));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(fetch).toHaveBeenCalledOnce();
        expect(MicrosoftTokenProvider.prototype.getToken).toHaveBeenCalledTimes(2);
    });

    it('retries a known transient native source-read failure before dispatch', async () => {
        vi.useFakeTimers();
        vi.mocked(source.verifyAccess).mockRejectedValueOnce(new NativeTeamsError('Network'));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(source.verifyAccess).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('retries a positively identified pre-dispatch timeout', async () => {
        vi.useFakeTimers();
        const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat');
        send.mockRejectedValueOnce(new TeamsOperationError('Timeout', 'ic3', 'timeout', 'not-attempted', undefined, true));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(send).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('retains the source account pin when refreshing credentials for a retry', async () => {
        vi.useFakeTimers();
        const good = await vi.mocked(MicrosoftTokenProvider.prototype.getToken).getMockImplementation()!();
        const claims = JSON.parse(Buffer.from(good.accessToken.split('.')[1], 'base64url').toString('utf8'));
        claims.oid = source.account.tenantId;
        vi.mocked(MicrosoftTokenProvider.prototype.getToken)
            .mockResolvedValueOnce(good).mockResolvedValueOnce({
                ...good, accessToken: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`,
            });
        fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal);
        const failed = expect(sending).rejects.toMatchObject({ code: 'authentication', retryable: false });
        await vi.advanceTimersByTimeAsync(1000);
        await failed;
        expect(fetch).toHaveBeenCalledOnce();
        expect(source.verifyAccess).toHaveBeenCalledOnce();
    });

    it('does not retry a malformed success response with uncertain delivery', async () => {
        fetch.mockResolvedValueOnce(new Response('{}', { status: 201 }));
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal))
            .rejects.toMatchObject({ code: 'protocol', outcome: 'unknown' });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('honors Retry-After and retries only the failed chunk, not a confirmed prefix', async () => {
        vi.useFakeTimers();
        fetch.mockResolvedValueOnce(new Response(JSON.stringify({ OriginalArrivalTime: '12345' }), { status: 201 }))
            .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '5' } }));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'long answer\n'.repeat(4000), new AbortController().signal);
        await vi.advanceTimersByTimeAsync(4999);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        await sending;
        const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).content);
        expect(bodies.filter(body => body === bodies[0])).toHaveLength(1);
        expect(bodies[1]).toBe(bodies[2]);
    });

    it('stops after three attempts with bounded exponential backoff', async () => {
        vi.useFakeTimers();
        fetch.mockImplementation(async () => new Response(null, { status: 401 }));
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal);
        const failed = expect(sending).rejects.toMatchObject({ outcome: 'rejected', retryable: true });
        await vi.advanceTimersByTimeAsync(3000);
        await failed;
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([403, 404, 408, 500])('never retries permanent or uncertain HTTP %s', async status => {
        fetch.mockResolvedValueOnce(new Response(null, { status }));
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal)).rejects.toThrow();
        expect(fetch).toHaveBeenCalledOnce();
    });

    it.each(['AccountMismatch', 'AccessDenied', 'InvalidTokenResponse', 'CliUnavailable'] as const)(
        'never retries permanent native authentication failure %s', async code => {
            vi.mocked(MicrosoftTokenProvider.prototype.getToken).mockRejectedValueOnce(new AuthError(code));
            await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal)).rejects.toThrow();
            expect(MicrosoftTokenProvider.prototype.getToken).toHaveBeenCalledOnce();
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    it('does not retry sooner than a Retry-After beyond the bounded wait allowance', async () => {
        fetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal)).rejects.toThrow();
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('cancels retry backoff without a late send', async () => {
        vi.useFakeTimers();
        fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const controller = new AbortController();
        const sending = sendTeamsIc3OwnCommandReply(source, id, 'answer', controller.signal);
        const failed = expect(sending).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await failed;
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetch).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects unknown delivery even if a retry flag is mistakenly supplied', async () => {
        vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockRejectedValueOnce(
            new TeamsOperationError('Unknown', 'ic3', 'timeout', 'unknown', undefined, true));
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal)).rejects.toThrow();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledOnce();
    });

    it.each(['19:fixture@thread.v2', '19:fixture@unq.gbl.spaces', '19:meeting_fixture@thread.v2'])(
        'posts safe attributed HTML to the exact source chat through IC3 only: %s', async chatId => {
        const dispose = vi.spyOn(Ic3DirectMessageClient.prototype, 'dispose');
        const signal = new AbortController().signal;
        await sendTeamsIc3OwnCommandReply({ ...source, chatId }, id, 'Answer **bold** <script>unsafe</script>', signal);
        expect(fetch).toHaveBeenCalledOnce();
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(`https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`);
        const body = JSON.parse(String(init?.body));
        expect(body.conversationid).toBe(chatId);
        expect(body.messagetype).toBe('RichText/Html');
        expect(body.content).toContain('CoC');
        expect(body.content).toContain('<strong>bold</strong>');
        expect(body.content).not.toContain('<script>');
        expect(body.content.startsWith('<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1790000000000">')).toBe(true);
        expect(body.content).toContain('<p>@coc explain this</p></blockquote>');
        expect(source.verifyAccess).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('uses the existing explicit IC3 self sender for the self stream', async () => {
        const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat');
        const dispose = vi.spyOn(Ic3DirectMessageClient.prototype, 'dispose');
        const signal = new AbortController().signal;
        await sendTeamsIc3OwnCommandReply({ ...source, chatId: '48:notes' }, id, '@coc answer text', signal);
        expect(send).toHaveBeenCalledExactlyOnceWith('48:notes', expect.stringContaining('CoC'), source.verifyAccess, signal);
        expect(send.mock.calls[0][1]).not.toMatch(/^@coc/);
        const timestamp = new Date().toISOString();
        expect(admitTeamsIc3OwnCommand({ account: source.account, chat: { chatId: '48:notes', kind: 'self' } }, {
            chatId: '48:notes', messageId: 'sent', createdAt: timestamp, modifiedAt: timestamp,
            authorKind: 'user', authorId: source.account.userId, deleted: false,
            text: '@coc answer text', untrustedHtml: send.mock.calls[0][1],
            textTruncated: false, htmlTruncated: false,
        })).toMatchObject({ kind: 'ignored', reason: 'not-command' });
        expect(fetch.mock.calls[0][0]).toBe('https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/48%3Anotes/messages');
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('splits long answers with the shared Teams formatter and sends all parts in order', async () => {
        await sendTeamsIc3OwnCommandReply(source, id, 'line of answer\n'.repeat(4000), new AbortController().signal);
        expect(fetch.mock.calls.length).toBeGreaterThan(1);
        for (const [index, [, init]] of fetch.mock.calls.entries()) {
            const body = JSON.parse(String(init?.body)).content;
            expect(Buffer.byteLength(body)).toBeLessThanOrEqual(20_000);
            expect(body).toContain(`Part ${index + 1}/${fetch.mock.calls.length}`);
            expect(body).toContain('itemid="1790000000000"');
        }
    });

    it('escapes and bounds the original message preview without copying untrusted HTML', async () => {
        await sendTeamsIc3OwnCommandReply({
            ...source, replyTo: { messageId: '1790000000001', text: '@coc <script>&"\n' + '\u{1f600}'.repeat(400) },
        }, id, 'answer\n'.repeat(5000), new AbortController().signal);
        for (const [, init] of fetch.mock.calls) {
            const html = JSON.parse(String(init?.body)).content;
            expect(Buffer.byteLength(html)).toBeLessThanOrEqual(20_000);
            expect(html).toContain('itemid="1790000000001"');
            expect(html).toContain('&lt;script&gt;&amp;&quot;');
            expect(html).not.toContain('<script>');
            expect(html).toContain('...</p></blockquote>');
            expect(html.match(/\u{1f600}/gu)).toHaveLength(184);
            expect(html).not.toContain('\ufffd');
        }
    });

    it.each(['', 'root', '123" onclick="bad', '1'.repeat(21)])(
        'rejects invalid reply message ID %s before authentication or dispatch', async messageId => {
            await expect(sendTeamsIc3OwnCommandReply({
                ...source, replyTo: { ...source.replyTo, messageId },
            }, id, 'answer', new AbortController().signal)).rejects.toThrow('original message ID and text');
            expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    it('rejects a missing original message preview without posting an unlinked answer', async () => {
        await expect(sendTeamsIc3OwnCommandReply({
            ...source, replyTo: { ...source.replyTo, text: ' ' },
        }, id, 'answer', new AbortController().signal)).rejects.toThrow('original message ID and text');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('stops on an uncertain send without replay, fallback or later chunks', async () => {
        const dispose = vi.spyOn(Ic3DirectMessageClient.prototype, 'dispose');
        fetch.mockRejectedValueOnce(new Error('Private transport failure'));
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'long answer\n'.repeat(4000), new AbortController().signal))
            .rejects.toMatchObject({ backend: 'ic3', outcome: 'unknown' });
        expect(fetch).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('rejects revoked source access without dispatch and disposes credentials', async () => {
        const dispose = vi.spyOn(Ic3DirectMessageClient.prototype, 'dispose');
        vi.mocked(source.verifyAccess).mockRejectedValueOnce(new Error('Source access denied'));
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', new AbortController().signal)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('does not authenticate or send when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(sendTeamsIc3OwnCommandReply(source, id, 'answer', controller.signal)).rejects.toThrow();
        expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
});
