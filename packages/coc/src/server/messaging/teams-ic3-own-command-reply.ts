import { Ic3DirectMessageClient, Ic3ReactionClient, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { setTimeout as delay } from 'node:timers/promises';
import type { TeamsIc3Account, TeamsIc3SessionOptions } from '@plusplusoneplusplus/coc-native';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { formatTeamsOutbound } from './teams-outbound-format';
import { checkTeamsOutboundCompliance, TeamsOutboundComplianceFailed, TeamsOutboundComplianceRejected, type TeamsOutboundCompliance } from './teams-outbound-compliance';

export interface TeamsIc3CommandSource {
    account: TeamsIc3Account;
    chatId: string;
    region: TeamsIc3SessionOptions['region'];
    verifyAccess(signal: AbortSignal): Promise<void>;
    compliance?: TeamsOutboundCompliance;
}

/** Reuse connector protocols; replies never create a chat or change the source account. */
export async function sendTeamsIc3OwnCommandReply(
    source: TeamsIc3CommandSource, requestId: string, answer: string, signal: AbortSignal,
): Promise<void> {
    signal.throwIfAborted();
    const parts = formatTeamsAnswerChunks(answer, requestId.slice(-12)).map(part => formatTeamsOutbound(part, 'html'));
    await sendTeamsIc3SourceReply(source, parts, signal);
}

/** Parts are trusted, already-formatted HTML; uncertain sends are never replayed. */
export async function sendTeamsIc3SourceReply(
    source: TeamsIc3CommandSource, parts: readonly string[], signal: AbortSignal,
): Promise<void> {
    signal.throwIfAborted();
    const account = { tenantId: source.account.tenantId, objectId: source.account.userId };
    const { chatId, region, verifyAccess } = source;
    const capturedParts = [...parts];
    const compliance = source.compliance;
    if (compliance) {
        const messageId = compliance.trigger.messageId;
        try {
            await checkTeamsOutboundCompliance(compliance, {
                tenantId: account.tenantId, userId: account.objectId, chatId, region,
            }, capturedParts, signal);
        } catch (error) {
            if (!(error instanceof TeamsOutboundComplianceRejected)) throw new TeamsOutboundComplianceFailed(error, signal);
            try {
                signal.throwIfAborted();
                await verifyAccess(signal);
                signal.throwIfAborted();
                const reaction = new Ic3ReactionClient({ region, expectedAccount: account });
                try {
                    await reaction.reactToSourceMessage(chatId, messageId, 'crossmark', signal);
                    signal.throwIfAborted();
                } finally { reaction.dispose(); }
            } catch (reactionError) {
                throw new TeamsOutboundComplianceRejected(reactionError);
            }
            throw error;
        }
        signal.throwIfAborted();
    }
    const sender = new Ic3DirectMessageClient({ region, expectedAccount: account });
    try {
        for (const part of capturedParts) {
            for (let attempt = 0; ; attempt++) {
                signal.throwIfAborted();
                try {
                    await sender.sendToSourceChat(chatId, part, verifyAccess, signal);
                    break;
                } catch (error) {
                    if (signal.aborted || attempt === 2 || !(error instanceof TeamsOperationError)
                        || error.backend !== 'ic3' || !error.retryable || error.outcome === 'unknown') throw error;
                    const wait = Math.max(1000 * 2 ** attempt, error.retryAfterMs ?? 0);
                    if (!Number.isFinite(wait) || wait > 60_000) throw error;
                    sender.clearCredential();
                    await delay(wait, undefined, { signal });
                }
            }
        }
    } finally { sender.dispose(); }
}
