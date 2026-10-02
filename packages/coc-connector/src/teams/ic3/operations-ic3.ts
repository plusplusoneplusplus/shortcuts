import { Ic3CredentialStore } from './ic3-credential';
import { Ic3DirectMessageClient } from './ic3-direct-message';
import { IC3_SELF_CHAT, type Ic3DirectMessageOptions } from './ic3-direct-message-config';
import { Ic3ReactionClient } from './ic3-reaction';
import {
    messageReceipt, requireSupport, validateAction, TeamsOperationError, type OperationContext, type OperationSupport,
    type SendReceipt, type TeamsAction, type TeamsDestination, type TeamsMessageBody,
    type TeamsMessageRef, type TeamsOperations,
} from '../operations';

export interface Ic3OperationsOptions extends Ic3DirectMessageOptions {
    connectionId: string;
    enableSelfSend?: boolean;
    /** Hybrid owners must fail closed when they cannot establish the primary account identity. */
    requireAccountMatch?: boolean;
}

/** Standalone experimental IC3 writes; no MCP discovery or initialization. */
export class Ic3Operations implements TeamsOperations {
    readonly backend = 'ic3' as const;
    readonly connectionId: string;
    private readonly enableSelfSend: boolean;
    private readonly accountUnavailable: boolean;
    private readonly credentials: Ic3CredentialStore;
    private readonly sender: Ic3DirectMessageClient;
    private readonly reactions: Ic3ReactionClient;
    private disposed = false;

    constructor(options: Ic3OperationsOptions) {
        this.connectionId = options.connectionId;
        this.enableSelfSend = options.enableSelfSend === true;
        this.accountUnavailable = options.requireAccountMatch === true && !options.expectedAccount;
        this.credentials = new Ic3CredentialStore(options);
        this.sender = new Ic3DirectMessageClient(options, this.credentials);
        this.reactions = new Ic3ReactionClient(options, this.credentials);
    }

    support(action: TeamsAction): OperationSupport {
        if (this.disposed) return { supported: false, reason: 'unavailable' };
        try {
            validateAction(action, this.backend, this.connectionId);
        } catch (error) {
            if (error instanceof TeamsOperationError) return { supported: false, reason: 'unsupported' };
            throw error;
        }
        if (action.kind === 'send' && action.destination.kind === 'self' && action.body.mentions === undefined) {
            return this.enableSelfSend ? { supported: true } : { supported: false, reason: 'disabled' };
        }
        // MCP channel references preserve the exact chatsvc channel/message identity.
        // Graph references have no proven mapping and cannot be translated implicitly.
        if (action.kind === 'react' && action.reaction === 'like'
            && action.message.destination.kind === 'channel'
            && (action.message.backend === 'ic3' || action.message.backend === 'mcp')) {
            return { supported: true };
        }
        return { supported: false, reason: 'unsupported' };
    }

    async send(destination: TeamsDestination, body: TeamsMessageBody, context?: OperationContext): Promise<SendReceipt> {
        this.requireAction({ kind: 'send', destination, body });
        const target = { ...destination };
        const content = body.contentType === 'html' ? body.content : body.content
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r\n|\r|\n/g, '<br>');
        const id = await this.sender.send(IC3_SELF_CHAT, content, undefined, context?.signal);
        return messageReceipt(this, target, id);
    }

    async reply(parent: TeamsMessageRef, body: TeamsMessageBody, _context?: OperationContext): Promise<SendReceipt> {
        this.requireAction({ kind: 'reply', parent, body });
        throw new TeamsOperationError('Unsupported IC3 reply', this.backend, 'unsupported', 'not-attempted');
    }

    async react(message: TeamsMessageRef, reaction: 'like', context?: OperationContext): Promise<void> {
        this.requireAction({ kind: 'react', message, reaction });
        if (message.destination.kind !== 'channel') {
            throw new TeamsOperationError('IC3 Like requires a channel', this.backend, 'unsupported', 'not-attempted');
        }
        await this.reactions.reactToChannelMessage({
            channelId: message.destination.channelId, messageId: message.messageId, text: '',
        }, context?.signal);
    }

    private requireAction(action: TeamsAction): void {
        requireSupport(this, action);
        this.credentials.requireRegion();
        if (this.accountUnavailable) {
            throw new TeamsOperationError('IC3 primary account identity unavailable',
                this.backend, 'authentication', 'not-attempted');
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.credentials.dispose();
    }
}
