import { boundedIc3, ic3HttpError, Ic3CredentialStore } from './ic3-credential';
import type { Ic3DirectMessageOptions, Ic3TokenProvider } from './ic3-direct-message-config';
import { TeamsOperationError } from '../operations';
import type { InboundTeamsMessage } from '../types';

export class Ic3ReactionClient {
    private readonly credentials: Ic3CredentialStore;

    constructor(options: Ic3TokenProvider | Ic3DirectMessageOptions = {}, credentials?: Ic3CredentialStore) {
        this.credentials = credentials ?? new Ic3CredentialStore(
            typeof options === 'function' ? { acquireToken: options } : options);
    }

    clearCredential(): void {
        this.credentials.clear();
    }

    dispose(): void {
        this.credentials.dispose();
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
                const response = await boundedIc3(fetch(url, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${credential.value}`,
                        'Content-Type': 'application/json', Accept: 'application/json',
                        behavioroverride: 'redirectAs404',
                    },
                    body: JSON.stringify({ emotions: { key: 'like', value: Date.now() } }),
                    signal, redirect: 'error',
                }), signal);
                await boundedIc3(Promise.resolve(response.body?.cancel()), signal);
                if (!response.ok) throw ic3HttpError(response);
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
