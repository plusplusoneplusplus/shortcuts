import { Ic3DirectMessageClient, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { setTimeout as delay } from 'node:timers/promises';
import type { TeamsIc3Account, TeamsIc3SessionOptions } from '@plusplusoneplusplus/coc-native';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { formatTeamsOutbound } from './teams-outbound-format';

export interface TeamsIc3CommandSource {
    account: TeamsIc3Account;
    chatId: string;
    region: TeamsIc3SessionOptions['region'];
    verifyAccess(signal: AbortSignal): Promise<void>;
}

/** Reuse connector protocols; replies never create a chat or change the source account. */
export async function sendTeamsIc3OwnCommandReply(
    source: TeamsIc3CommandSource, requestId: string, answer: string, signal: AbortSignal,
): Promise<void> {
    signal.throwIfAborted();
    const account = { tenantId: source.account.tenantId, objectId: source.account.userId };
    const parts = formatTeamsAnswerChunks(answer, requestId.slice(-12)).map(part => formatTeamsOutbound(part, 'html'));
    const sender = new Ic3DirectMessageClient({ region: source.region, expectedAccount: account });
    try {
        for (const part of parts) {
            for (let attempt = 0; ; attempt++) {
                signal.throwIfAborted();
                try {
                    await sender.sendToSourceChat(source.chatId, part, source.verifyAccess, signal);
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
