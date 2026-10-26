import { Ic3DirectMessageClient, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { setTimeout as delay } from 'node:timers/promises';
import type { TeamsIc3Account, TeamsIc3SessionOptions } from '@plusplusoneplusplus/coc-native';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { formatTeamsOutbound } from './teams-outbound-format';
import { checkTeamsOutboundCompliance, type TeamsOutboundCompliance } from './teams-outbound-compliance';

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
    if (source.compliance) {
        await checkTeamsOutboundCompliance(source.compliance, {
            tenantId: account.tenantId, userId: account.objectId, chatId, region,
        }, capturedParts, signal);
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
