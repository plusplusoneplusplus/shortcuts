import { randomBytes } from 'node:crypto';
import { IC3_SELF_CHAT, type Ic3DirectMessageOptions } from './ic3-direct-message-config';
import { boundedIc3, ic3HttpError, Ic3CredentialStore } from './ic3-credential';
import { TeamsOperationError, type TeamsFailureCode } from '../operations';
import type { TransportSendOptions } from '../types';

export type { Ic3DirectMessageOptions, Ic3DirectMessageRegion, Ic3TokenProvider }
    from './ic3-direct-message-config';

/** IC3 sends are never replayed: a failed response can still mean delivery. */
export class TeamsIc3SendError extends TeamsOperationError {
    constructor(message: string, code: TeamsFailureCode = 'network',
        outcome: 'not-attempted' | 'rejected' | 'unknown' = 'unknown', retryAfterMs?: number) {
        super(`Teams IC3 direct send ${message}`, 'ic3', code, outcome, retryAfterMs);
        this.name = 'TeamsIc3SendError';
    }
}

/** Experimental chatsvc sender. 48:notes is the current account's generic self-chat marker. */
export class Ic3DirectMessageClient {
    private readonly credentials: Ic3CredentialStore;

    constructor(options: Ic3DirectMessageOptions = {}, credentials?: Ic3CredentialStore) {
        try {
            this.credentials = credentials ?? new Ic3CredentialStore(options);
        } catch (error) {
            if (error instanceof TeamsOperationError) {
                throw new TeamsIc3SendError(error.message, error.code, error.outcome, error.retryAfterMs);
            }
            throw error;
        }
    }

    clearCredential(): void {
        this.credentials.clear();
    }

    dispose(): void {
        this.credentials.dispose();
    }

    async send(conversationId: string, text: string, opts?: TransportSendOptions, caller?: AbortSignal): Promise<string> {
        if (conversationId !== IC3_SELF_CHAT || opts?.replyToId !== undefined || opts?.mentions !== undefined) {
            throw new TeamsIc3SendError('unavailable: only self-chat 48:notes without replies or mentions is supported',
                'unsupported', 'not-attempted');
        }
        if (typeof text !== 'string' || !text.trim()) {
            throw new TeamsIc3SendError('unavailable: nonempty text is required', 'unsupported', 'not-attempted');
        }
        try {
            return await this.credentials.run(async attempt => {
                const { signal } = attempt;
                const credential = await this.credentials.get(signal, true);
                signal.throwIfAborted();
                const sender = `8:orgid:${credential.objectId}`;
                const now = new Date().toISOString();
                const body = JSON.stringify({
                    id: '-1', type: 'Message', conversationid: conversationId,
                    conversationLink: `blah/${conversationId}`,
                    from: sender, fromUserId: sender,
                    composetime: now, originalarrivaltime: now,
                    content: text, messagetype: 'RichText/Html', contenttype: 'Text',
                    imdisplayname: credential.displayName,
                    clientmessageid: (randomBytes(8).readBigUInt64BE() & 0x7fffffffffffffffn).toString(),
                    callId: '', state: 0, version: '0', amsreferences: [],
                    properties: {
                        importance: '', subject: '', title: '', cards: '[]', links: '[]',
                        mentions: '[]', onbehalfof: null, files: '[]', policyViolation: null,
                        formatVariant: 'TEAMS',
                    },
                });
                attempt.writeStarted = true;
                const response = await boundedIc3(fetch(
                    `https://teams.cloud.microsoft/api/chatsvc/${this.credentials.region}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}/messages`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${credential.value}`,
                            Accept: 'application/json', 'Content-Type': 'application/json',
                            behavioroverride: 'redirectAs404',
                        },
                        body, signal, redirect: 'error',
                    },
                ), signal);
                if (!response.ok) {
                    await boundedIc3(Promise.resolve(response.body?.cancel()), signal);
                    throw ic3HttpError(response);
                }
                let result: unknown;
                try {
                    result = await boundedIc3(response.json(), signal);
                } catch {
                    throw new TeamsOperationError('returned an invalid message ID; delivery may be unknown',
                        'ic3', 'protocol', 'unknown');
                }
                const id = result && typeof result === 'object'
                    ? (result as { OriginalArrivalTime?: unknown }).OriginalArrivalTime : undefined;
                if ((typeof id !== 'string' || !/^\d+$/.test(id))
                    && (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)) {
                    throw new TeamsOperationError('returned an invalid message ID; delivery may be unknown',
                        'ic3', 'protocol', 'unknown');
                }
                return String(id);
            }, caller);
        } catch (error) {
            if (error instanceof TeamsOperationError) {
                throw new TeamsIc3SendError(error.message, error.code, error.outcome, error.retryAfterMs);
            }
            throw new TeamsIc3SendError('failed; delivery may be unknown');
        }
    }
}
