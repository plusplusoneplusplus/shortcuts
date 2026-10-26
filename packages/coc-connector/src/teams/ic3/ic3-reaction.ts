import { setTimeout as delay } from 'node:timers/promises';
import { boundedIc3, ic3HttpError, Ic3CredentialStore } from './ic3-credential';
import type { Ic3DirectMessageOptions, Ic3TokenProvider } from './ic3-direct-message-config';
import { TeamsOperationError } from '../operations';
import type { InboundTeamsMessage } from '../types';

const sourceReactions = {
    eyes: '1f440_eyes',
    checkmark: '2714_heavycheckmark',
    crossmark: '274c_crossmark',
} as const;

export class Ic3ReactionClient {
    private readonly credentials: Ic3CredentialStore;
    private readonly sourceAccountPinned: boolean;
    private readonly lifetime = new AbortController();

    constructor(options: Ic3TokenProvider | Ic3DirectMessageOptions = {}, credentials?: Ic3CredentialStore) {
        this.sourceAccountPinned = typeof options !== 'function' && !!options.expectedAccount;
        this.credentials = credentials ?? new Ic3CredentialStore(
            typeof options === 'function' ? { acquireToken: options } : options);
    }

    clearCredential(): void {
        this.credentials.clear();
    }

    dispose(): void {
        this.lifetime.abort();
        this.credentials.dispose();
    }

    /** Trusted ingress supplies the exact message from a fresh, account-pinned native chat read. */
    async acknowledgeSourceMessage(chatId: string, messageId: string, caller?: AbortSignal): Promise<void> {
        const signal = AbortSignal.any([this.lifetime.signal, ...(caller ? [caller] : [])]);
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.writeSourceReaction(chatId, messageId, 'eyes', signal, null);
            } catch (error) {
                if (signal.aborted || attempt === 2 || !(error instanceof TeamsOperationError)
                    || !error.retryable || error.outcome === 'unknown') throw error;
                const wait = Math.max(1000 * 2 ** attempt, error.retryAfterMs ?? 0);
                if (!Number.isFinite(wait) || wait > 60_000) throw error;
                this.credentials.clear();
                try {
                    await delay(wait, undefined, { signal });
                } catch (error) {
                    if (!signal.aborted) throw error;
                    throw new TeamsOperationError('IC3 source acknowledgment cancelled',
                        'ic3', 'unavailable', 'not-attempted');
                }
            }
        }
    }

    /** The caller verifies the task outcome; this transport does not infer success or rejection. */
    async reactToSourceMessage(
        chatId: string, messageId: string, reaction: 'eyes' | 'checkmark' | 'crossmark', caller?: AbortSignal,
    ): Promise<void> {
        return this.writeSourceReaction(chatId, messageId, reaction, caller);
    }

    private async writeSourceReaction(
        chatId: string, messageId: string, reaction: 'eyes' | 'checkmark' | 'crossmark',
        caller?: AbortSignal, timeoutMs?: number | null,
    ): Promise<void> {
        if (!Object.hasOwn(sourceReactions, reaction)) {
            throw new TeamsOperationError('IC3 source reaction is unsupported',
                'ic3', 'unsupported', 'not-attempted');
        }
        if (!this.sourceAccountPinned) {
            throw new TeamsOperationError('IC3 source reaction requires a pinned source account',
                'ic3', 'authentication', 'not-attempted');
        }
        if ((chatId !== '48:notes' && !/^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(chatId))
            || !messageId.trim()) {
            throw new TeamsOperationError('IC3 source reaction has an invalid source target',
                'ic3', 'invalid-target', 'not-attempted');
        }
        await this.credentials.run(async attempt => {
            const { signal } = attempt;
            const credential = await this.credentials.get(signal);
            signal.throwIfAborted();
            const base = `https://teams.cloud.microsoft/api/chatsvc/${this.credentials.region}/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`;
            attempt.startWrite();
            await this.putReaction(`${base}/${encodeURIComponent(messageId)}/properties?name=emotions`,
                sourceReactions[reaction], credential.value, signal);
        }, caller, timeoutMs);
    }

    private async putReaction(url: string, key: string, token: string, signal: AbortSignal): Promise<void> {
        const response = await boundedIc3(fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json', Accept: 'application/json',
                behavioroverride: 'redirectAs404',
            },
            body: JSON.stringify({ emotions: { key, value: Date.now() } }),
            signal, redirect: 'error',
        }), signal);
        await boundedIc3(Promise.resolve(response.body?.cancel()), signal);
        if (!response.ok) throw ic3HttpError(response);
    }

    async reactToChannelMessage(msg: InboundTeamsMessage, caller?: AbortSignal): Promise<void> {
        try {
            if (!msg.channelId?.trim() || !msg.messageId?.trim()) {
                throw new TeamsOperationError('unavailable: missing message target', 'ic3', 'invalid-target', 'not-attempted');
            }
            await this.credentials.run(async attempt => {
                const { signal } = attempt;
                const credential = await this.credentials.get(signal);
                signal.throwIfAborted();
                const url = `https://teams.cloud.microsoft/api/chatsvc/${this.credentials.region}/v1/users/ME/conversations/${encodeURIComponent(msg.channelId!)}`
                    + `/messages/${encodeURIComponent(msg.messageId)}/properties?name=emotions`;
                attempt.writeStarted = true;
                await this.putReaction(url, 'like', credential.value, signal);
            }, caller);
        } catch (error) {
            if (error instanceof TeamsOperationError) {
                throw new TeamsOperationError(`Teams channel Like reaction ${error.message}`, 'ic3',
                    error.code, error.outcome, error.retryAfterMs);
            }
            throw new TeamsOperationError('Teams channel Like reaction failed', 'ic3', 'network', 'unknown');
        }
    }
}
