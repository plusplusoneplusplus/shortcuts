import { McpClient, McpHttpError } from './mcp-client';
import {
    TeamsOperationError, messageReceipt, requireSupport, validateAction,
    type TeamsOperations, type TeamsAction, type OperationSupport, type TeamsDestination,
    type TeamsMessageBody, type TeamsMessageRef, type OperationContext, type SendReceipt,
} from '../operations';

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export class TeamsMcpSendRejectedError extends TeamsOperationError {
    constructor(message = 'Teams MCP send rejected') {
        super(message, 'mcp', 'rejected', 'rejected');
        this.name = 'TeamsMcpSendRejectedError';
    }
}

export interface McpOperationsOptions {
    connectionId: string;
    client: Pick<McpClient, 'callTool' | 'setBearerToken'>;
    /** Omit only for a fixed server binding whose supported tools are already known. */
    availableTools?: readonly string[];
    onTokenRefresh?: () => Promise<string | null>;
    onSelfChatResolved?: (chatId: string) => void;
}

export class McpOperations implements TeamsOperations {
    readonly backend = 'mcp';
    readonly connectionId: string;
    private readonly tools?: ReadonlySet<string>;
    private readonly lifetime = new AbortController();

    constructor(private readonly options: McpOperationsOptions) {
        this.options = { ...options };
        this.connectionId = options.connectionId;
        this.tools = options.availableTools && new Set(options.availableTools);
    }

    private tool(action: TeamsAction): string | undefined {
        if (action.kind === 'react') return undefined;
        if (action.kind === 'reply') {
            return action.parent.destination.kind === 'channel' && action.parent.backend === 'mcp'
                ? 'ReplyToChannelMessage' : undefined;
        }
        return action.destination.kind === 'self' ? 'SendMessageToSelf'
            : action.destination.kind === 'chat' ? 'SendMessageToChat' : 'SendMessageToChannel';
    }

    support(action: TeamsAction): OperationSupport {
        if (this.lifetime.signal.aborted) return { supported: false, reason: 'unavailable' };
        try { validateAction(action, this.backend, this.connectionId); }
        catch (error) {
            if (error instanceof TeamsOperationError) return { supported: false, reason: 'unsupported' };
            throw error;
        }
        const tool = this.tool(action);
        return tool && (!this.tools || this.tools.has(tool))
            ? { supported: true } : { supported: false, reason: 'unsupported' };
    }

    async send(destination: TeamsDestination, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        return this.write({ kind: 'send', destination, body }, context);
    }

    async reply(parent: TeamsMessageRef, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        return this.write({ kind: 'reply', parent, body }, context);
    }

    async react(message: TeamsMessageRef, reaction: 'like'): Promise<void> {
        requireSupport(this, { kind: 'react', message, reaction });
    }

    private async write(action: Exclude<TeamsAction, { kind: 'react' }>, context?: OperationContext): Promise<SendReceipt> {
        requireSupport(this, action);
        const destination = { ...(action.kind === 'send' ? action.destination : action.parent.destination) };
        const rootId = action.kind === 'reply' ? action.parent.rootMessageId ?? action.parent.messageId : undefined;
        const args: Record<string, unknown> = {
            content: action.body.content.replace(/\\/g, '\\\\'),
            contentType: action.body.contentType,
        };
        if (destination.kind === 'channel') Object.assign(args, { teamId: destination.teamId, channelId: destination.channelId });
        if (destination.kind === 'chat') args.chatId = destination.chatId;
        if (rootId) args.messageId = rootId;
        if (action.body.mentions?.length) {
            args.mentions = action.body.mentions.map((mention, index) => ({
                id: index, mentionText: mention.displayName,
                mentioned: { user: { id: mention.id, displayName: mention.displayName } },
            }));
        }
        const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000),
            ...(context?.signal ? [context.signal] : [])]);
        let attempted = false;
        try {
            signal.throwIfAborted();
            const call = () => {
                signal.throwIfAborted();
                attempted = true;
                // Session recovery may replay a write with an unknown delivery outcome.
                return untilAborted(this.options.client.callTool(this.tool(action)!, args, signal,
                    { retryExpiredSession: false }), signal);
            };
            let result;
            try {
                result = await call();
            } catch (error) {
                if (!(error instanceof McpHttpError) || error.status !== 401 || !this.options.onTokenRefresh) throw error;
                // A transport-level 401 is a definite refusal, unlike a tool/network error.
                attempted = false;
                const token = await untilAborted(this.options.onTokenRefresh(), signal);
                signal.throwIfAborted();
                if (!token) throw error;
                this.options.client.setBearerToken(token);
                result = await call();
            }
            const text = result.content?.find(part => part.type === 'text')?.text ?? '';
            if (result.isError || text.startsWith('Error:')) throw new TeamsMcpSendRejectedError();
            let parsed: unknown;
            try { parsed = JSON.parse(text); }
            catch { throw new TeamsOperationError('Invalid Teams MCP send response', 'mcp', 'protocol', 'unknown'); }
            const data = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
            const receipt = messageReceipt(this, destination, data.messageId ?? data.id, rootId);
            if (destination.kind === 'self' && typeof data.chatId === 'string' && data.chatId.trim()) {
                this.options.onSelfChatResolved?.(data.chatId);
            }
            return receipt;
        } catch (error) {
            if (error instanceof TeamsOperationError) throw error;
            if (error instanceof McpHttpError) {
                const definite = [400, 401, 403, 429].includes(error.status);
                throw new TeamsOperationError(`Teams MCP HTTP ${error.status}`, 'mcp',
                    error.status === 401 || error.status === 403 ? 'authentication'
                        : error.status === 429 ? 'rate-limited'
                            : error.status === 408 || error.status === 504 ? 'timeout'
                                : error.status >= 500 ? 'unavailable' : 'rejected',
                    definite ? 'rejected' : 'unknown', error.retryAfterMs);
            }
            throw new TeamsOperationError(signal.aborted ? 'Teams MCP operation cancelled or timed out' : 'Teams MCP operation failed',
                'mcp', signal.aborted ? 'timeout' : 'network', attempted ? 'unknown' : 'not-attempted');
        }
    }

    async dispose(): Promise<void> {
        this.lifetime.abort();
    }
}
