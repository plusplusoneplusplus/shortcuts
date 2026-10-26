import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3DirectMessageClient, Ic3ReactionClient, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createDecisionService } from '../../../src/server/decisions/decision-service';
import { COPILOT_DECISION_TIMEOUT_MS } from '../../../src/server/decisions/copilot-decision-backend';
import { DECISION_LIMITS } from '../../../src/server/decisions/decision-validation';
import { sendTeamsIc3OwnCommandReply, sendTeamsIc3SourceReply, type TeamsIc3CommandSource }
    from '../../../src/server/messaging/teams-ic3-own-command-reply';
import { formatTeamsReactionNotice, sendTeamsReactionReply, sendTeamsReactionResult }
    from '../../../src/server/messaging/teams-reaction-reply';
import { TeamsOutboundComplianceRejected, type TeamsOutboundCompliance }
    from '../../../src/server/messaging/teams-outbound-compliance';
import { RELAY_ANSWER_TEXT } from '../../../src/server/messaging/relay-answer';

function output(block = 0, allow = 1) {
    return {
        success: true,
        text: JSON.stringify({ answers: { compliance: { type: 'choice', probabilities: { block, allow } } } }),
    };
}

function harness(type: 'mention' | 'reaction' = 'mention') {
    const sdk = createMockSDKService().service;
    vi.spyOn(sdk, 'isTransformAvailable').mockResolvedValue({ available: true });
    const transform = vi.spyOn(sdk, 'transform').mockResolvedValue(output());
    const service = createDecisionService(sdk);
    const evaluate = vi.spyOn(service, 'evaluate');
    const policy = { enabled: true, prompt: 'Permit only compliant messages.' };
    const compliance: TeamsOutboundCompliance = {
        getPolicy: vi.fn(() => policy),
        decisionService: service,
        workspaceId: 'ws-fixture', workingDirectory: resolve('fixture-workspace'),
        trigger: { type, messageId: 'original-request', text: '@coc do the work', untrustedHtml: '<p>do the work</p>' },
    };
    const source: TeamsIc3CommandSource = {
        account: { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' },
        chatId: '19:fixture@thread.v2', region: 'amer', verifyAccess: vi.fn(async () => {}),
        compliance,
    };
    return { source, sdk, transform, evaluate, policy, compliance };
}

describe('Teams complete-message compliance delivery boundary', () => {
    beforeEach(() => {
        vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockResolvedValue('sent-fixture');
        vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage').mockResolvedValue(undefined);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    it('allows a complete plain-text trigger without an optional native HTML body', async () => {
        const h = harness();
        h.compliance.trigger.untrustedHtml = undefined;
        await sendTeamsIc3OwnCommandReply(h.source, 'request-id', 'Safe answer', new AbortController().signal);
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(h.evaluate.mock.calls[0][0]).toMatchObject({
            state: { trigger: { type: 'mention', messageId: 'original-request', text: '@coc do the work' } },
        });
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledOnce();
    });

    it.each(['mention', 'reaction'] as const)('evaluates every formatted chunk once before any %s text is sent', async type => {
        const h = harness(type);
        h.transform.mockImplementation(async () => {
            expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
            return output();
        });
        await sendTeamsIc3OwnCommandReply(h.source, 'request-id', 'Safe **answer**\n'.repeat(3000), new AbortController().signal);
        const sent = vi.mocked(Ic3DirectMessageClient.prototype.sendToSourceChat).mock.calls;
        expect(sent.length).toBeGreaterThan(1);
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        const [body, context] = h.evaluate.mock.calls[0];
        expect(body).toMatchObject({
            backend: 'copilot',
            state: {
                message: sent.map(call => call[1]).join('\n'),
                chunks: sent.map(call => call[1]), trigger: h.compliance.trigger,
                destination: { ...h.source.account, chatId: h.source.chatId, region: 'amer' },
            },
            questions: { compliance: {
                type: 'choice', instructions: { administratorPolicy: h.policy.prompt },
            } },
        });
        expect(context).toMatchObject({
            workspaceId: h.compliance.workspaceId, workingDirectory: h.compliance.workingDirectory, allowOutputRepair: false,
        });
        expect(sent[0][1]).toContain('<strong>answer</strong>');
        expect(sent[0][1]).toContain('CoC');
        expect(h.transform.mock.calls[0][1]).toMatchObject({ model: 'gpt-6-luna', loadDefaultMcpConfig: false });
    });

    it.each(Object.entries(RELAY_ANSWER_TEXT))('gates fixed mention response %s', async (_kind, text) => {
        const h = harness();
        h.transform.mockResolvedValue(output(1, 0));
        await expect(sendTeamsIc3OwnCommandReply(h.source, 'request-id', text, new AbortController().signal))
            .rejects.toBeInstanceOf(TeamsOutboundComplianceRejected);
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).toHaveBeenCalledExactlyOnceWith(
            h.source.chatId, 'original-request', 'crossmark', expect.any(AbortSignal));
    });

    it.each(['task', 'approval'] as const)('gates the fixed %s refusal and retains compliance when capturing the reaction source', async kind => {
        const h = harness('reaction');
        const notice = { sourceText: 'Full original request', result: { kind, outcome: 'rejected' as const } };
        h.transform.mockResolvedValue(output(1, 0));
        await expect(sendTeamsReactionResult({ ...h.source, messageId: 'original-request' }, notice, new AbortController().signal))
            .rejects.toBeInstanceOf(TeamsOutboundComplianceRejected);
        expect(h.evaluate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            state: expect.objectContaining({ chunks: [formatTeamsReactionNotice(notice)] }),
        }), expect.objectContaining({ allowOutputRepair: false }));
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).toHaveBeenCalledExactlyOnceWith(
            h.source.chatId, 'original-request', 'crossmark', expect.any(AbortSignal));
    });

    it('covers direct reaction notices without treating emoji-only completion as text', async () => {
        const h = harness('reaction');
        const notice = { sourceText: 'Request', result: { kind: 'task' as const, outcome: 'done' as const } };
        await sendTeamsReactionResult({ ...h.source, messageId: 'original-request' }, notice, new AbortController().signal);
        expect(h.evaluate).not.toHaveBeenCalled();
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).toHaveBeenCalledOnce();
        await sendTeamsReactionReply(h.source, notice, new AbortController().signal);
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledOnce();
    });

    it('blocks the whole multipart message before an earlier chunk can escape', async () => {
        const h = harness();
        h.transform.mockResolvedValue(output(1, 0));
        await expect(sendTeamsIc3OwnCommandReply(h.source, 'request-id', 'long answer\n'.repeat(4000), new AbortController().signal))
            .rejects.toBeInstanceOf(TeamsOutboundComplianceRejected);
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
    });

    it.each(['mention', 'reaction'] as const)('reacts only to the captured original %s request after explicit rejection', async type => {
        const h = harness(type);
        const verify = h.source.verifyAccess;
        const dispose = vi.spyOn(Ic3ReactionClient.prototype, 'dispose');
        let finish!: () => void;
        h.transform.mockImplementation(async () => {
            await new Promise<void>(resolve => { finish = resolve; });
            return output(1, 0);
        });
        const sending = sendTeamsIc3SourceReply(h.source, ['<p>first</p>', '<p>second</p>'], new AbortController().signal);
        const rejected = expect(sending).rejects.toBeInstanceOf(TeamsOutboundComplianceRejected);
        await vi.waitFor(() => expect(h.transform).toHaveBeenCalledOnce());
        h.source.chatId = '19:changed@thread.v2';
        h.source.region = 'emea';
        h.source.account.userId = h.source.account.tenantId;
        h.compliance.trigger.messageId = 'changed-request';
        h.source.verifyAccess = vi.fn(async () => { throw new Error('Changed verifier'); });
        finish();
        await rejected;
        expect(verify).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).toHaveBeenCalledExactlyOnceWith(
            '19:fixture@thread.v2', 'original-request', 'crossmark', expect.any(AbortSignal));
        expect(dispose).toHaveBeenCalledOnce();
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
    });

    it.each([
        ['mention', 'access'], ['mention', 'write'], ['mention', 'cancelled'],
        ['reaction', 'access'], ['reaction', 'write'], ['reaction', 'cancelled'],
    ] as const)('preserves %s rejection when its reaction fails at %s without retry or text fallback', async (type, failure) => {
        const h = harness(type);
        const controller = new AbortController();
        const reason = new TeamsOperationError('Fixture failure', 'ic3', 'timeout', 'unknown', undefined, true);
        const dispose = vi.spyOn(Ic3ReactionClient.prototype, 'dispose');
        h.transform.mockResolvedValue(output(1, 0));
        if (failure === 'access') vi.mocked(h.source.verifyAccess).mockRejectedValueOnce(reason);
        if (failure === 'write') vi.mocked(Ic3ReactionClient.prototype.reactToSourceMessage).mockRejectedValueOnce(reason);
        if (failure === 'cancelled') vi.mocked(h.source.verifyAccess).mockImplementationOnce(async () => { controller.abort(reason); });
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>blocked</p>'], controller.signal))
            .rejects.toMatchObject({
                name: 'TeamsOutboundComplianceRejected',
                message: 'Teams outbound text was blocked by the compliance policy. The rejection reaction failed.',
                rejectionReactionError: reason,
            });
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).toHaveBeenCalledTimes(failure === 'write' ? 1 : 0);
        expect(dispose).toHaveBeenCalledTimes(failure === 'write' ? 1 : 0);
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
    });

    it('fails closed on a tied choice without using a confidence threshold', async () => {
        const h = harness();
        h.transform.mockResolvedValue(output(1, 1));
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal))
            .rejects.toBeInstanceOf(TeamsOutboundComplianceRejected);
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
        h.transform.mockResolvedValue(output(0.499, 0.501));
        await sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal);
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledOnce();
    });

    it('snapshots policy, trigger, destination and chunks while a decision is pending', async () => {
        const h = harness();
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        h.transform.mockImplementation(async () => { await waiting; return output(); });
        const parts = ['<p>original answer</p>'];
        const sending = sendTeamsIc3SourceReply(h.source, parts, new AbortController().signal);
        await vi.waitFor(() => expect(h.transform).toHaveBeenCalledOnce());
        h.policy.prompt = 'Changed policy';
        h.source.chatId = '19:other@thread.v2';
        h.source.account.userId = h.source.account.tenantId;
        h.source.region = 'emea';
        h.compliance.trigger.text = 'Changed trigger';
        parts[0] = '<p>changed answer</p>';
        finish();
        await sending;
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledExactlyOnceWith(
            '19:fixture@thread.v2', '<p>original answer</p>', h.source.verifyAccess, expect.any(AbortSignal));
        const prompt = h.transform.mock.calls[0][0];
        expect(prompt).toContain('Permit only compliant messages.');
        expect(prompt).toContain('@coc do the work');
        expect(prompt).not.toContain('Changed');
        await sendTeamsIc3SourceReply(h.source, parts, new AbortController().signal);
        expect(h.transform.mock.calls[1][0]).toContain('Changed policy');
        expect(h.evaluate).toHaveBeenCalledTimes(2);
    });

    it('keeps concurrent workspace decisions, policies, sources and deliveries independent', async () => {
        const a = harness();
        const b = harness('reaction');
        b.compliance.workspaceId = 'ws-other';
        b.compliance.workingDirectory = resolve('other-workspace');
        b.source.chatId = '19:other@thread.v2';
        b.policy.prompt = 'Block this workspace.';
        b.transform.mockResolvedValue(output(1, 0));
        const results = await Promise.allSettled([
            sendTeamsIc3SourceReply(a.source, ['<p>allowed</p>'], new AbortController().signal),
            sendTeamsIc3SourceReply(b.source, ['<p>blocked</p>'], new AbortController().signal),
        ]);
        expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
        expect(a.evaluate).toHaveBeenCalledOnce();
        expect(b.evaluate).toHaveBeenCalledOnce();
        expect(b.evaluate.mock.calls[0][1]).toMatchObject({ workspaceId: 'ws-other', workingDirectory: resolve('other-workspace') });
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledExactlyOnceWith(
            a.source.chatId, '<p>allowed</p>', a.source.verifyAccess, expect.any(AbortSignal));
    });

    it('preserves disabled and unrelated source delivery without requiring context or a backend', async () => {
        const h = harness();
        h.policy.enabled = false;
        h.policy.prompt = '';
        h.compliance.decisionService = undefined;
        h.compliance.workspaceId = '';
        await sendTeamsIc3SourceReply(h.source, ['<p>disabled</p>'], new AbortController().signal);
        await sendTeamsIc3SourceReply({ ...h.source, compliance: undefined }, ['<p>unrelated</p>'], new AbortController().signal);
        expect(h.evaluate).not.toHaveBeenCalled();
        expect(h.transform).not.toHaveBeenCalled();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledTimes(2);
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).not.toHaveBeenCalled();
    });

    it.each(['not json', '{"answers":{}}', '{"answers":{"compliance":{"type":"noul","value":1}}}'])(
        'does not repair malformed output: %s', async text => {
            const h = harness();
            h.transform.mockResolvedValue({ success: true, text });
            await expect(sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal))
                .rejects.toMatchObject({ code: 'DECISION_INVALID_OUTPUT' });
            expect(h.evaluate).toHaveBeenCalledOnce();
            expect(h.transform).toHaveBeenCalledOnce();
            expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
            expect(Ic3ReactionClient.prototype.reactToSourceMessage).not.toHaveBeenCalled();
        },
    );

    it.each(['policy', 'trigger', 'workspace', 'chunks'] as const)('fails without complete %s evidence', async missing => {
        const h = harness();
        if (missing === 'policy') h.policy.prompt = ' \n ';
        if (missing === 'trigger') h.compliance.trigger.messageId = '';
        if (missing === 'workspace') h.compliance.workspaceId = '';
        await expect(sendTeamsIc3SourceReply(h.source, missing === 'chunks' ? [] : ['<p>answer</p>'], new AbortController().signal))
            .rejects.toMatchObject({ code: 'DECISION_INVALID_REQUEST' });
        expect(h.evaluate).not.toHaveBeenCalled();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
    });

    it('rejects oversized UTF-8 evidence without truncation or inference', async () => {
        const h = harness();
        h.compliance.trigger.text = '\u{1f916}'.repeat(DECISION_LIMITS.maxBodyBytes / 4);
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal))
            .rejects.toMatchObject({ code: 'DECISION_REQUEST_TOO_LARGE' });
        expect(h.evaluate).not.toHaveBeenCalled();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
    });

    it('accepts the exact decision byte limit and rejects one byte more', async () => {
        const h = harness();
        const signal = new AbortController().signal;
        await sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], signal);
        const bodyBytes = Buffer.byteLength(JSON.stringify(h.evaluate.mock.calls[0][0]), 'utf8');
        h.compliance.trigger.text += 'x'.repeat(DECISION_LIMITS.maxBodyBytes - bodyBytes);
        await sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], signal);
        expect(Buffer.byteLength(JSON.stringify(h.evaluate.mock.calls[1][0]), 'utf8')).toBe(DECISION_LIMITS.maxBodyBytes);
        h.compliance.trigger.text += 'x';
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], signal))
            .rejects.toMatchObject({ code: 'DECISION_REQUEST_TOO_LARGE' });
        expect(h.evaluate).toHaveBeenCalledTimes(2);
        expect(h.transform).toHaveBeenCalledTimes(2);
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledTimes(2);
    });

    it.each(['missing-service', 'unavailable', 'upstream-failure'] as const)('fails closed for %s without retry or fallback', async failure => {
        const h = harness();
        if (failure === 'missing-service') h.compliance.decisionService = undefined;
        if (failure === 'unavailable') vi.mocked(h.sdk.isTransformAvailable).mockResolvedValue({ available: false });
        if (failure === 'upstream-failure') h.transform.mockResolvedValue({ success: false, text: '', error: 'Fixture failure' });
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal)).rejects.toThrow();
        expect(h.evaluate.mock.calls.length).toBe(failure === 'missing-service' ? 0 : 1);
        expect(h.transform.mock.calls.length).toBe(failure === 'upstream-failure' ? 1 : 0);
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).not.toHaveBeenCalled();
    });

    it('bounds stalled readiness as part of the single compliance evaluation', async () => {
        vi.useFakeTimers();
        const h = harness();
        vi.mocked(h.sdk.isTransformAvailable).mockImplementation(() => new Promise(() => {}));
        const sending = sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal);
        const failed = expect(sending).rejects.toMatchObject({ code: 'DECISION_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(COPILOT_DECISION_TIMEOUT_MS);
        await failed;
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).not.toHaveBeenCalled();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels pending readiness promptly and prevents a late allow from sending', async () => {
        const h = harness();
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(h.sdk.isTransformAvailable).mockImplementation(async () => { await waiting; return { available: true }; });
        const controller = new AbortController();
        const sending = sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], controller.signal);
        const reason = new Error('Fixture cancellation');
        controller.abort(reason);
        await expect(sending).rejects.toBe(reason);
        finish();
        await vi.waitFor(() => expect(h.evaluate).toHaveBeenCalledOnce());
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
        expect(Ic3ReactionClient.prototype.reactToSourceMessage).not.toHaveBeenCalled();
    });

    it('does not start evaluation if cancellation occurs while capturing policy', async () => {
        const h = harness();
        const controller = new AbortController();
        const reason = new Error('Fixture policy cancellation');
        h.compliance.getPolicy = () => { controller.abort(reason); return h.policy; };
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], controller.signal)).rejects.toBe(reason);
        expect(h.evaluate).not.toHaveBeenCalled();
        expect(h.transform).not.toHaveBeenCalled();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).not.toHaveBeenCalled();
    });

    it('retries known-unsent transport failure under the same exact allowance, not another decision', async () => {
        vi.useFakeTimers();
        const h = harness();
        vi.mocked(Ic3DirectMessageClient.prototype.sendToSourceChat).mockRejectedValueOnce(
            new TeamsOperationError('Timeout', 'ic3', 'timeout', 'not-attempted', undefined, true));
        const sending = sendTeamsIc3SourceReply(h.source, ['<p>answer</p>'], new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1000);
        await sending;
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never replays an unknown send outcome or allows later chunks', async () => {
        const h = harness();
        vi.mocked(Ic3DirectMessageClient.prototype.sendToSourceChat).mockRejectedValueOnce(
            new TeamsOperationError('Unknown', 'ic3', 'timeout', 'unknown', undefined, true));
        await expect(sendTeamsIc3SourceReply(h.source, ['<p>first</p>', '<p>second</p>'], new AbortController().signal))
            .rejects.toMatchObject({ outcome: 'unknown' });
        expect(h.evaluate).toHaveBeenCalledOnce();
        expect(h.transform).toHaveBeenCalledOnce();
        expect(Ic3DirectMessageClient.prototype.sendToSourceChat).toHaveBeenCalledOnce();
    });
});
