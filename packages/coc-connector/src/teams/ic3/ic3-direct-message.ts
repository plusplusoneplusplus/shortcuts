import { randomBytes } from 'node:crypto';
import { IC3_SELF_CHAT, IC3_SOURCE_REPLY_TIMEOUT_MS, type Ic3DirectMessageOptions } from './ic3-direct-message-config';
import { boundedIc3, ic3HttpError, Ic3CredentialStore } from './ic3-credential';
import { TeamsOperationError, type TeamsFailureCode, type TeamsDestination } from '../operations';
import type { TransportSendOptions } from '../types';
import { NativeTeamsError } from '@plusplusoneplusplus/coc-native';

export type { Ic3DirectMessageOptions, Ic3DirectMessageRegion, Ic3TokenProvider }
    from './ic3-direct-message-config';

/** IC3 sends are never replayed: a failed response can still mean delivery. */
export class TeamsIc3SendError extends TeamsOperationError {
    constructor(message: string, code: TeamsFailureCode = 'network',
        outcome: 'not-attempted' | 'rejected' | 'unknown' = 'unknown', retryAfterMs?: number, retryable = false) {
        super(`Teams IC3 direct send ${message}`, 'ic3', code, outcome, retryAfterMs, retryable);
        this.name = 'TeamsIc3SendError';
    }
}

/** Experimental chatsvc sender with distinct verified-recipient and source-chat reply entry points. */
export class Ic3DirectMessageClient {
    private readonly credentials: Ic3CredentialStore;
    private readonly options: Ic3DirectMessageOptions;

    constructor(options: Ic3DirectMessageOptions = {}, credentials?: Ic3CredentialStore) {
        this.options = { ...options, expectedAccount: options.expectedAccount ? { ...options.expectedAccount } : undefined };
        try {
            this.credentials = credentials ?? new Ic3CredentialStore(options);
        } catch (error) {
            if (error instanceof TeamsOperationError) {
                throw new TeamsIc3SendError(error.message, error.code, error.outcome, error.retryAfterMs, error.retryable);
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

    async send(target: string | Extract<TeamsDestination, { kind: 'chat' }>, text: string,
        opts?: TransportSendOptions, caller?: AbortSignal): Promise<string> {
        return this.sendMessage(target, text, opts, caller);
    }

    /** Trusted inbound owners recheck exact source access on their pinned reader before each reply. */
    async sendToSourceChat(chatId: string, text: string,
        verifyAccess: (signal: AbortSignal) => Promise<void>, caller?: AbortSignal,
        threadRootId?: string): Promise<string> {
        if (!this.options.expectedAccount || typeof verifyAccess !== 'function') {
            throw new TeamsIc3SendError('source replies require a pinned account and a live source access check',
                'authentication', 'not-attempted');
        }
        if (chatId !== IC3_SELF_CHAT && !/^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(chatId)) {
            throw new TeamsIc3SendError('invalid source chat', 'invalid-target', 'not-attempted');
        }
        if (threadRootId !== undefined && (chatId === IC3_SELF_CHAT || !/^\d{1,20}$/.test(threadRootId))) {
            throw new TeamsIc3SendError('invalid source thread root', 'invalid-target', 'not-attempted');
        }
        return this.sendMessage(chatId, text, undefined, caller, verifyAccess, threadRootId);
    }

    private async sendMessage(target: string | Extract<TeamsDestination, { kind: 'chat' }>, text: string,
        opts?: TransportSendOptions, caller?: AbortSignal,
        sourceAccess?: (signal: AbortSignal) => Promise<void>, threadRootId?: string): Promise<string> {
        const destination = typeof target === 'string' ? undefined : { ...target };
        const conversationId = typeof target === 'string' ? target : target.chatId;
        if (opts?.replyToId !== undefined || opts?.mentions !== undefined
            || (!destination && conversationId !== IC3_SELF_CHAT && !sourceAccess)) {
            throw new TeamsIc3SendError('unavailable: only self-chat 48:notes without replies or mentions is supported',
                'unsupported', 'not-attempted');
        }
        if (destination) {
            if (destination.kind !== 'chat' || !/^19:[^\s/\\?#]+@thread\.v2$/.test(conversationId)
                || destination.connectionId !== this.options.connectionId || !destination.connectionId
                || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(destination.recipientId ?? '')) {
                throw new TeamsIc3SendError('invalid existing 1:1 destination or connection', 'invalid-target', 'not-attempted');
            }
            if (!this.options.expectedAccount || !this.options.verifyChat) {
                throw new TeamsIc3SendError('unavailable: account identity and chat verification are required',
                    'authentication', 'not-attempted');
            }
        }
        if (typeof text !== 'string' || !text.trim()) {
            throw new TeamsIc3SendError('unavailable: nonempty text is required', 'unsupported', 'not-attempted');
        }
        try {
            return await this.credentials.run(async attempt => {
                const { signal } = attempt;
                const credential = await this.credentials.get(signal, true);
                signal.throwIfAborted();
                if (destination || sourceAccess) {
                    const account = this.options.expectedAccount!;
                    if (credential.objectId?.toLowerCase() !== account.objectId.toLowerCase()
                        || credential.tenantId?.toLowerCase() !== account.tenantId.toLowerCase()) {
                        throw new TeamsOperationError('IC3 account identity mismatch', 'ic3', 'authentication', 'not-attempted');
                    }
                }
                if (sourceAccess) {
                    try {
                        await boundedIc3(sourceAccess(signal), signal);
                    } catch (error) {
                        throw new TeamsOperationError('Source chat access could not be verified',
                            'ic3', 'unavailable', 'not-attempted',
                            error instanceof NativeTeamsError ? error.retryAfterMs : undefined,
                            error instanceof NativeTeamsError && ['Authentication', 'Network', 'Timeout', 'RateLimited'].includes(error.code));
                    }
                    signal.throwIfAborted();
                }
                if (destination) {
                    let verified: Awaited<ReturnType<NonNullable<Ic3DirectMessageOptions['verifyChat']>>>;
                    try {
                        verified = await boundedIc3(this.options.verifyChat!(conversationId, signal), signal);
                    } catch {
                        throw new TeamsOperationError('Existing 1:1 verification unavailable; check MCP GetChat and ListChatMembers access',
                            'ic3', 'unavailable', 'not-attempted');
                    }
                    signal.throwIfAborted();
                    const members = verified.memberIds?.map(id => typeof id === 'string' ? id.toLowerCase() : '');
                    const recipient = destination.recipientId!.toLowerCase();
                    if (verified.chatId !== conversationId || verified.connectionId !== destination.connectionId
                        || verified.chatType !== 'oneOnOne' || members?.length !== 2
                        || new Set(members).size !== 2 || !members.includes(credential.objectId!.toLowerCase())
                        || recipient === credential.objectId!.toLowerCase() || !members.includes(recipient)) {
                        throw new TeamsOperationError('Destination is not the verified existing 1:1 chat for this account and recipient',
                            'ic3', 'invalid-target', 'not-attempted');
                    }
                }
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
                attempt.startWrite();
                const response = await boundedIc3(fetch(
                    `https://teams.cloud.microsoft/api/chatsvc/${this.credentials.region}/v1/users/ME/conversations/${encodeURIComponent(
                        threadRootId === undefined ? conversationId : `${conversationId};messageid=${threadRootId}`)}/messages`,
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
            }, caller, sourceAccess ? IC3_SOURCE_REPLY_TIMEOUT_MS : undefined);
        } catch (error) {
            if (error instanceof TeamsOperationError) {
                throw new TeamsIc3SendError(error.message, error.code, error.outcome, error.retryAfterMs, error.retryable);
            }
            throw new TeamsIc3SendError('failed; delivery may be unknown');
        }
    }
}
