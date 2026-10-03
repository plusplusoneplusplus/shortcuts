/**
 * GraphTransport — TeamsTransport implementation using Microsoft Graph API.
 * Supports two targets:
 * - Channel mode: sends to a Teams channel (requires teamId + channelId)
 * - Chat mode (default): sends as a direct message to the user's 1:1 chat
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from '../types';
import type { TeamsReadHints } from '../notification-scheduler';
import { GraphClient } from './graph-client';
import { randomUUID } from 'node:crypto';
import { GraphOperations } from './operations-graph';
import { RoutedTeamsOperations, type TeamsDestination, type TeamsOperationRoutes } from '../operations';

export class GraphTransport implements TeamsTransport {
    private client: GraphClient | null = null;
    private teamId: string | null = null;
    private chatId: string | null = null;
    private _useChat = false;
    private outbound: RoutedTeamsOperations | null = null;
    readonly connectionId: string;
    debug = false;

    constructor(private readonly operationOptions: {
        connectionId?: string;
        routes?: Partial<TeamsOperationRoutes>;
        onTokenRefresh?: () => Promise<string | null>;
    } = {}) {
        this.connectionId = operationOptions.connectionId ?? randomUUID();
        this.operationOptions = { ...operationOptions, routes: { ...operationOptions.routes } };
    }

    get operations(): RoutedTeamsOperations {
        if (!this.outbound) throw new Error('GraphTransport not initialized');
        return this.outbound;
    }

    async initialize(token: string, opts: { teamId?: string; channelId?: string; chatId?: string }): Promise<void> {
        void this.outbound?.dispose();
        this.outbound = null;
        this.teamId = opts.teamId ?? null;
        this.chatId = opts.chatId ?? null;
        this._useChat = !opts.teamId;
        const client = new GraphClient({
            bearerToken: token,
            teamId: opts.teamId,
            channelId: opts.channelId,
            chatId: opts.chatId,
        });
        this.client = client;

        // Graph mode is send-only. Just verify token works via /me endpoint.
        // Chat discovery (getOrCreateChat) requires Chat.ReadBasic which typical
        // az cli tokens don't have, so we skip it entirely.
        if (opts.teamId) {
            await client.verifyConnection();
        } else {
            // Verify token is valid without needing Chat permissions
            await client.getMe();
        }
        if (this.client !== client) throw new Error('Teams connection cancelled');
        if (!opts.teamId) console.log(`[graph-transport] Token verified via /me. Send-only mode (no chat discovery).`);
        this.outbound = new RoutedTeamsOperations({
            selfSend: 'graph', chatSend: 'graph', channelSend: 'graph', channelReply: 'graph', channelLike: 'graph',
            ...this.operationOptions.routes,
        }, [new GraphOperations({ client, connectionId: this.connectionId,
            onTokenRefresh: this.operationOptions.onTokenRefresh })]);
    }

    async send(target: string, text: string, opts?: TransportSendOptions): Promise<string> {
        if (!this.client) throw new Error('GraphTransport not initialized');

        const destination: TeamsDestination = this.teamId
            ? { kind: 'channel', teamId: this.teamId, channelId: target }
            : { kind: 'chat', chatId: this.chatId ?? target };
        const body = { content: text, contentType: 'html' as const,
            mentions: opts?.mentions?.map(m => ({ id: m.aadId, displayName: m.displayName })) };
        const receipt = opts?.replyToId !== undefined
            ? await this.operations.reply({ destination, messageId: opts.replyToId,
                backend: 'graph', connectionId: this.connectionId }, body)
            : await this.operations.send(destination, body);
        return receipt.message.messageId;
    }

    async reactToChannelMessage(msg: InboundTeamsMessage): Promise<void> {
        if (!this.client || this._useChat || !this.teamId) {
            throw new Error('Teams channel Like reaction unavailable in direct messages or while disconnected');
        }
        await this.operations.react({
            destination: { kind: 'channel', teamId: this.teamId, channelId: msg.channelId },
            messageId: msg.messageId, rootMessageId: msg.replyToMessageId,
            backend: 'graph', connectionId: this.connectionId,
        }, 'like');
    }

    async poll(target: string, since?: string, hints?: TeamsReadHints): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('GraphTransport not initialized');

        if (this._useChat) {
            return this.pollChat(since);
        }
        return this.pollChannel(target, since, hints);
    }

    private async pollChat(since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        const chatId = this.chatId!;
        const rawMessages = await this.client!.listChatMessages(chatId, { top: 20 });

        // Sort oldest-first
        const sorted = [...rawMessages].sort((a, b) =>
            new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
        );

        const filtered = since
            ? sorted.filter(m => new Date(m.createdDateTime).getTime() > new Date(since).getTime())
            : sorted;

        const messages: InboundTeamsMessage[] = filtered
            .filter(msg => (msg.body?.content ?? '').trim())
            .map(msg => ({
                channelId: chatId,
                messageId: msg.id,
                text: msg.body?.content ?? '',
                senderName: msg.from?.user?.displayName,
                senderAadId: msg.from?.user?.id,
                botAuthored: !!msg.from?.application,
                replyToMessageId: msg.replyToId,
            }));

        const nextSince = filtered.length > 0 ? filtered[filtered.length - 1].createdDateTime : (since ?? '');
        return { messages, nextSince };
    }

    private async pollChannel(channelId: string, since?: string, hints?: TeamsReadHints): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        this.client!.setChannelId(channelId);
        const rawMessages = await this.client!.listChannelMessages({ top: 50,
            ...(hints ? { pageSince: since, signal: AbortSignal.any([
                AbortSignal.timeout(300_000), ...(hints.signal ? [hints.signal] : []),
            ]) } : {}),
        });

        // Sort oldest-first
        const sorted = [...rawMessages].sort((a, b) =>
            new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
        );

        const fresh = since
            ? sorted.filter(msg => new Date(msg.createdDateTime).getTime() > new Date(since).getTime())
            : sorted;
        const messages: InboundTeamsMessage[] = fresh
            .filter(msg => (msg.body?.content ?? '').trim())
            .map(msg => ({
                channelId,
                messageId: msg.id,
                text: msg.body?.content ?? '',
                senderName: msg.from?.user?.displayName,
                senderAadId: msg.from?.user?.id,
                botAuthored: !!msg.from?.application,
                replyToMessageId: msg.replyToId,
            }));

        const nextSince = fresh.length > 0 ? fresh[fresh.length - 1].createdDateTime : (since ?? '');
        return { messages, nextSince };
    }

    /** Get the resolved chat ID (for direct message mode). */
    getChatId(): string | null {
        return this.chatId;
    }

    async listChannels(teamId: string): Promise<TeamsChannel[]> {
        if (!this.client) throw new Error('GraphTransport not initialized');
        const channels = await this.client.listChannels(teamId);
        return channels.map(ch => ({ id: ch.id, displayName: ch.displayName }));
    }

    async resolveTeamAndChannel(teamName: string, channelName: string): Promise<{ teamId: string; channelId: string }> {
        if (!this.client) throw new Error('GraphTransport not initialized');
        const result = await this.client.resolveOrCreateTeamAndChannel(teamName, channelName);
        this.teamId = result.teamId;
        return result;
    }

    setToken(token: string): void {
        this.client?.setBearerToken(token);
    }

    setChannelId(channelId: string): void {
        if (this._useChat) return;
        this.client?.setChannelId(channelId);
    }

    stop(): void {
        this.client = null;
        void this.outbound?.dispose();
        this.outbound = null;
    }
}
