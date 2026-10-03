import { GraphClient, GraphHttpError, GraphProtocolError } from './graph-client';
import {
    actionDestination, messageReceipt, requireSupport, validateAction, TeamsOperationError,
    type OperationContext, type OperationSupport, type SendReceipt, type TeamsAction,
    type TeamsDestination, type TeamsMessageBody, type TeamsMessageRef, type TeamsOperations,
} from '../operations';

export interface GraphOperationsOptions {
    connectionId: string;
    client: GraphClient;
    onTokenRefresh?: (signal?: AbortSignal) => Promise<string | null>;
    acquireToken?: (signal: AbortSignal) => Promise<string>;
    timeoutMs?: number;
}

/** Stateless outbound targets; discovery and polling remain with the transport. */
export class GraphOperations implements TeamsOperations {
    readonly backend = 'graph' as const;
    readonly connectionId: string;
    private readonly client: GraphClient;
    private readonly onTokenRefresh?: GraphOperationsOptions['onTokenRefresh'];
    private readonly acquireToken?: GraphOperationsOptions['acquireToken'];
    private readonly timeoutMs: number;
    private readonly lifetime = new AbortController();

    constructor(options: GraphOperationsOptions) {
        this.connectionId = options.connectionId;
        this.client = options.client;
        this.onTokenRefresh = options.onTokenRefresh;
        this.acquireToken = options.acquireToken;
        this.timeoutMs = options.timeoutMs ?? 10_000;
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) {
            throw new RangeError('Graph operation timeout must be a positive bounded duration');
        }
    }

    support(action: TeamsAction): OperationSupport {
        if (this.lifetime.signal.aborted) return { supported: false, reason: 'unavailable' };
        try { validateAction(action, this.backend, this.connectionId); }
        catch (error) {
            if (error instanceof TeamsOperationError) return { supported: false, reason: 'unsupported' };
            throw error;
        }
        const destination = actionDestination(action);
        if (destination.kind === 'self'
            || (action.kind !== 'send' && destination.kind !== 'channel')
            || (action.kind === 'react' && action.reaction !== 'like')
            || (action.kind !== 'react' && destination.kind === 'chat' && !!action.body.mentions?.length)) {
            return { supported: false, reason: 'unsupported' };
        }
        if (action.kind !== 'send') {
            const ref = action.kind === 'reply' ? action.parent : action.message;
            if (ref.backend !== this.backend || ref.connectionId !== this.connectionId) {
                return { supported: false, reason: 'unsupported' };
            }
        }
        return { supported: true };
    }

    async send(destination: TeamsDestination, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        requireSupport(this, { kind: 'send', destination, body });
        const target = { ...destination };
        const mentions = body.mentions?.map(({ id, displayName }) => ({ aadId: id, displayName }));
        const { content, contentType } = body;
        return this.execute(async signal => {
            const id = target.kind === 'channel'
                ? await this.client.postChannelMessage(content, mentions, { ...target, contentType, signal })
                : await this.client.postChatMessage(content, target.kind === 'chat' ? target.chatId : '', { contentType, signal });
            return messageReceipt(this, target, id);
        }, context);
    }

    async reply(parent: TeamsMessageRef, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        this.validateReference(parent);
        requireSupport(this, { kind: 'reply', parent, body });
        const target = { ...parent.destination };
        const rootId = parent.rootMessageId ?? parent.messageId;
        const mentions = body.mentions?.map(({ id, displayName }) => ({ aadId: id, displayName }));
        const { content, contentType } = body;
        return this.execute(async signal => {
            if (target.kind !== 'channel') throw new TeamsOperationError('Channel required', this.backend, 'unsupported', 'not-attempted');
            const id = await this.client.replyToChannelMessage(rootId, content, mentions, { ...target, contentType, signal });
            return messageReceipt(this, target, id, rootId);
        }, context);
    }

    async react(message: TeamsMessageRef, reaction: 'like', context?: OperationContext): Promise<void> {
        this.validateReference(message);
        requireSupport(this, { kind: 'react', message, reaction });
        const target = { ...message.destination };
        const { messageId, rootMessageId } = message;
        return this.execute(signal => {
            if (target.kind !== 'channel') throw new TeamsOperationError('Channel required', this.backend, 'unsupported', 'not-attempted');
            return this.client.reactToChannelMessage(messageId,
                rootMessageId === messageId ? undefined : rootMessageId, { ...target, signal });
        }, context);
    }

    async dispose(): Promise<void> {
        this.lifetime.abort();
    }

    private validateReference(ref: TeamsMessageRef): void {
        if (ref.backend !== this.backend || ref.connectionId !== this.connectionId) {
            throw new TeamsOperationError('Foreign Teams message reference', this.backend, 'invalid-target', 'not-attempted');
        }
    }

    private async execute<T>(write: (signal: AbortSignal) => Promise<T>, context?: OperationContext): Promise<T> {
        const deadline = new AbortController();
        const signal = AbortSignal.any([this.lifetime.signal, deadline.signal, ...(context?.signal ? [context.signal] : [])]);
        let outcome: 'not-attempted' | 'rejected' | 'unknown' = 'not-attempted';
        const cancellation = () => new TeamsOperationError('Graph operation cancelled or timed out', this.backend,
            this.lifetime.signal.aborted ? 'unavailable' : 'timeout', outcome);
        if (signal.aborted) throw cancellation();
        const timer = setTimeout(() => deadline.abort(), this.timeoutMs);
        let onAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(cancellation());
            signal.addEventListener('abort', onAbort, { once: true });
        });
        const attempt = async () => {
            if (this.acquireToken) {
                const token = await this.acquireToken(signal);
                if (signal.aborted) throw cancellation();
                this.client.setBearerToken(token);
            }
            if (signal.aborted) throw cancellation();
            outcome = 'unknown';
            return write(signal);
        };
        const work = async () => {
            try {
                return await attempt();
            } catch (error) {
                if (!(error instanceof GraphHttpError) || error.status !== 401 || !this.onTokenRefresh) throw error;
                outcome = 'rejected';
                if (signal.aborted) throw cancellation();
                let token: string | null;
                try {
                    token = await this.onTokenRefresh(signal);
                } catch (refreshError) {
                    if (refreshError instanceof TeamsOperationError) throw refreshError;
                    throw new TeamsOperationError('Graph token refresh failed', this.backend, 'authentication', 'rejected');
                }
                if (signal.aborted) throw cancellation();
                if (!token?.trim()) throw new TeamsOperationError('Graph token refresh failed', this.backend, 'authentication', 'rejected');
                this.client.setBearerToken(token);
                return attempt();
            }
        };
        try {
            return await Promise.race([work(), aborted]);
        } catch (error) {
            if (signal.aborted) throw cancellation();
            if (error instanceof TeamsOperationError) throw error;
            if (error instanceof GraphProtocolError) {
                throw new TeamsOperationError(error.message, this.backend, 'protocol', 'unknown');
            }
            if (error instanceof GraphHttpError) {
                const { status } = error;
                const code = status === 401 ? 'authentication' : status === 429 ? 'rate-limited'
                    : status === 408 || status === 504 ? 'timeout'
                    : status >= 500 ? 'unavailable' : status >= 400 ? 'rejected' : 'protocol';
                throw new TeamsOperationError(`Graph request failed (HTTP ${status})`, this.backend, code,
                    status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown', error.retryAfterMs);
            }
            throw new TeamsOperationError('Graph request failed without a definitive response', this.backend, 'network', 'unknown');
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        }
    }
}
