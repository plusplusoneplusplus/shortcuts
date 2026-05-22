/**
 * GraphTransport — TeamsTransport implementation using Microsoft Graph API.
 * Supports two targets:
 * - Channel mode: sends to a Teams channel (requires teamId + channelId)
 * - Chat mode (default): sends as a direct message to the user's 1:1 chat
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from './types';
import { GraphClient } from './graph-client';

export class GraphTransport implements TeamsTransport {
    private client: GraphClient | null = null;
    private teamId: string | null = null;
    private chatId: string | null = null;
    private _useChat = false;

    async initialize(token: string, opts: { teamId?: string; channelId?: string; chatId?: string }): Promise<void> {
        this.teamId = opts.teamId ?? null;
        this.chatId = opts.chatId ?? null;
        this.client = new GraphClient({
            bearerToken: token,
            teamId: opts.teamId,
            channelId: opts.channelId,
            chatId: opts.chatId,
        });

        // If no teamId, use chat mode (direct message)
        if (!opts.teamId) {
            this._useChat = true;
            // Find/create self-chat
            if (!this.chatId) {
                const me = await this.client.getMe();
                this.chatId = await this.client.getOrCreateChat(me.id);
            }
        } else {
            await this.client.verifyConnection();
        }
    }

    async send(target: string, text: string, opts?: TransportSendOptions): Promise<string> {
        if (!this.client) throw new Error('GraphTransport not initialized');

        if (this._useChat) {
            return this.client.postChatMessage(text, this.chatId ?? target);
        }

        this.client.setChannelId(target);
        if (opts?.replyToId) {
            return this.client.replyToChannelMessage(opts.replyToId, text, opts.mentions);
        }
        return this.client.postChannelMessage(text, opts?.mentions);
    }

    async poll(target: string, since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('GraphTransport not initialized');

        if (this._useChat) {
            return this.pollChat(since);
        }
        return this.pollChannel(target, since);
    }

    private async pollChat(since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        const chatId = this.chatId!;
        const rawMessages = await this.client!.listChatMessages(chatId, { top: 20 });

        // Sort oldest-first
        const sorted = [...rawMessages].sort((a, b) =>
            new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
        );

        // Filter to only messages after `since`
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
                replyToMessageId: msg.replyToId,
            }));

        const nextSince = filtered.length > 0 ? filtered[filtered.length - 1].createdDateTime : (since ?? '');
        return { messages, nextSince };
    }

    private async pollChannel(channelId: string, since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        this.client!.setChannelId(channelId);
        const filter = since ? `createdDateTime gt ${since}` : undefined;
        const rawMessages = await this.client!.listChannelMessages({ top: 20, filter });

        // Sort oldest-first
        const sorted = [...rawMessages].sort((a, b) =>
            new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
        );

        const messages: InboundTeamsMessage[] = sorted
            .filter(msg => (msg.body?.content ?? '').trim())
            .map(msg => ({
                channelId,
                messageId: msg.id,
                text: msg.body?.content ?? '',
                senderName: msg.from?.user?.displayName,
                senderAadId: msg.from?.user?.id,
                replyToMessageId: msg.replyToId,
            }));

        const nextSince = sorted.length > 0 ? sorted[sorted.length - 1].createdDateTime : (since ?? '');
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
    }
}
