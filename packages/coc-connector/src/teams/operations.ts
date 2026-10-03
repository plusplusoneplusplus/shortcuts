/** Outbound Teams operations are independent of polling and discovery. */
export type TeamsBackend = 'mcp' | 'ic3' | 'graph';

export type TeamsDestination =
    | { kind: 'self' }
    /** IC3 requires the intended recipient's object ID and current connection ID, plus fresh provider verification. */
    | { kind: 'chat'; chatId: string; recipientId?: string; connectionId?: string }
    | { kind: 'channel'; teamId: string; channelId: string };

export interface TeamsMessageRef {
    destination: TeamsDestination;
    messageId: string;
    rootMessageId?: string;
    backend: TeamsBackend;
    connectionId: string;
}

export interface TeamsMessageBody {
    content: string;
    contentType: 'text' | 'html';
    mentions?: ReadonlyArray<{ id: string; displayName: string }>;
}

export type TeamsAction =
    | { kind: 'send'; destination: TeamsDestination; body: TeamsMessageBody }
    | { kind: 'reply'; parent: TeamsMessageRef; body: TeamsMessageBody }
    | { kind: 'react'; message: TeamsMessageRef; reaction: 'like' };

export type OperationSupport =
    | { supported: true }
    | { supported: false; reason: 'unsupported' | 'disabled' | 'unavailable' };

export interface OperationContext {
    signal?: AbortSignal;
}

export interface SendReceipt {
    message: TeamsMessageRef;
    outcome: 'accepted';
}

export type TeamsFailureCode =
    | 'configuration'
    | 'unsupported' | 'invalid-target' | 'authentication' | 'rate-limited'
    | 'rejected' | 'timeout' | 'protocol' | 'network' | 'unavailable';

export class TeamsOperationError extends Error {
    constructor(
        message: string,
        readonly backend: TeamsBackend,
        readonly code: TeamsFailureCode,
        readonly outcome: 'not-attempted' | 'rejected' | 'unknown',
        readonly retryAfterMs?: number,
    ) {
        super(message);
        this.name = 'TeamsOperationError';
    }
}

export interface TeamsOperations {
    readonly backend: TeamsBackend;
    readonly connectionId: string;
    support(action: TeamsAction): OperationSupport;
    send(destination: TeamsDestination, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt>;
    reply(parent: TeamsMessageRef, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt>;
    react(message: TeamsMessageRef, reaction: 'like', context?: OperationContext): Promise<void>;
    dispose(): Promise<void>;
}

export interface TeamsOperationRoutes {
    selfSend: TeamsBackend;
    chatSend: TeamsBackend;
    channelSend: TeamsBackend;
    channelReply: TeamsBackend;
    channelLike: TeamsBackend;
}

export function actionDestination(action: TeamsAction): TeamsDestination {
    return action.kind === 'send' ? action.destination
        : action.kind === 'reply' ? action.parent.destination : action.message.destination;
}

/** Validate before acquiring credentials or dispatching any write. */
export function validateAction(action: TeamsAction, backend: TeamsBackend, connectionId: string): void {
    const destination = actionDestination(action);
    const validId = (id: string) => typeof id === 'string' && id.trim().length > 0;
    if (!validId(connectionId) || !['self', 'chat', 'channel'].includes(destination.kind)
        || (destination.kind === 'self' && 'chatId' in destination)
        || (destination.kind === 'chat' && (!validId(destination.chatId) || destination.chatId === '48:notes'
            || (destination.connectionId !== undefined && destination.connectionId !== connectionId)))
        || (destination.kind === 'channel' && (!validId(destination.teamId) || !validId(destination.channelId)))) {
        throw new TeamsOperationError('Invalid Teams destination', backend, 'invalid-target', 'not-attempted');
    }
    if (action.kind !== 'send') {
        const ref = action.kind === 'reply' ? action.parent : action.message;
        if (!validId(ref.messageId) || (ref.rootMessageId !== undefined && !validId(ref.rootMessageId))
            || ref.connectionId !== connectionId) {
            throw new TeamsOperationError('Invalid Teams message reference or connection', backend, 'invalid-target', 'not-attempted');
        }
    }
    if (action.kind !== 'react') {
        const body = action.body;
        if (typeof body.content !== 'string' || !body.content.trim()
            || !['text', 'html'].includes(body.contentType)
            || body.mentions?.some(mention => !validId(mention.id) || !validId(mention.displayName))) {
            throw new TeamsOperationError('Invalid Teams message body', backend, 'unsupported', 'not-attempted');
        }
    }
}

export function requireSupport(operations: TeamsOperations, action: TeamsAction): void {
    validateAction(action, operations.backend, operations.connectionId);
    const support = operations.support(action);
    if (!support.supported) {
        throw new TeamsOperationError(`Teams operation ${support.reason}`, operations.backend,
            support.reason === 'unsupported' ? 'unsupported' : 'unavailable', 'not-attempted');
    }
}

export function messageReceipt(
    operations: Pick<TeamsOperations, 'backend' | 'connectionId'>,
    destination: TeamsDestination, messageId: unknown, rootMessageId?: string,
): SendReceipt {
    if (typeof messageId !== 'string' || !messageId.trim()) {
        throw new TeamsOperationError('Teams response did not contain a message ID',
            operations.backend, 'protocol', 'unknown');
    }
    return {
        outcome: 'accepted',
        message: { destination: { ...destination }, messageId, backend: operations.backend,
            connectionId: operations.connectionId, ...(rootMessageId ? { rootMessageId } : {}) },
    };
}

/** Routes are snapshotted per owner/workspace. Writes never fail over or replay here. */
export class RoutedTeamsOperations {
    private readonly routes: Readonly<TeamsOperationRoutes>;
    private readonly backends: ReadonlyMap<TeamsBackend, TeamsOperations>;

    constructor(routes: TeamsOperationRoutes, backends: readonly TeamsOperations[]) {
        this.routes = Object.freeze({ ...routes });
        this.backends = new Map(backends.map(backend => [backend.backend, backend]));
        if (this.backends.size !== backends.length || backends.some(backend => !backend.connectionId.trim())
            || new Set(backends.map(backend => backend.connectionId)).size > 1) {
            throw new Error('Teams operation backends must have unique kinds and a shared connection ID');
        }
    }

    private route(action: TeamsAction): TeamsBackend {
        if (action.kind === 'reply') return this.routes.channelReply;
        if (action.kind === 'react') return this.routes.channelLike;
        return action.destination.kind === 'self' ? this.routes.selfSend
            : action.destination.kind === 'chat' ? this.routes.chatSend : this.routes.channelSend;
    }

    support(action: TeamsAction): OperationSupport {
        return this.backends.get(this.route(action))?.support(action)
            ?? { supported: false, reason: 'unavailable' };
    }

    private select(action: TeamsAction): TeamsOperations {
        const backend = this.route(action);
        const operations = this.backends.get(backend);
        if (!operations) throw new TeamsOperationError('Teams backend unavailable', backend, 'unavailable', 'not-attempted');
        requireSupport(operations, action);
        return operations;
    }

    async send(destination: TeamsDestination, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        return this.select({ kind: 'send', destination, body }).send(destination, body, context);
    }

    async reply(parent: TeamsMessageRef, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        return this.select({ kind: 'reply', parent, body }).reply(parent, body, context);
    }

    async react(message: TeamsMessageRef, reaction: 'like', context?: OperationContext): Promise<void> {
        return this.select({ kind: 'react', message, reaction }).react(message, reaction, context);
    }

    async dispose(): Promise<void> {
        await Promise.all([...this.backends.values()].map(backend => backend.dispose()));
    }
}
