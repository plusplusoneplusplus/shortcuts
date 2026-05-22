/**
 * GraphTransport — TeamsTransport implementation using Microsoft Graph API.
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from './types';
import { GraphClient } from './graph-client';

export class GraphTransport implements TeamsTransport {
    private client: GraphClient | null = null;
    private teamId: string | null = null;

    initialize(token: string, opts: { teamId?: string; channelId?: string }): Promise<void> {
        this.teamId = opts.teamId ?? null;
        this.client = new GraphClient({
            bearerToken: token,
            teamId: opts.teamId,
            channelId: opts.channelId,
        });
        return this.client.verifyConnection();
    }

    async send(channelId: string, text: string, opts?: TransportSendOptions): Promise<string> {
        if (!this.client) throw new Error('GraphTransport not initialized');
        this.client.setChannelId(channelId);
        if (opts?.replyToId) {
            return this.client.replyToChannelMessage(opts.replyToId, text, opts.mentions);
        }
        return this.client.postChannelMessage(text, opts?.mentions);
    }

    async poll(channelId: string, since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('GraphTransport not initialized');
        this.client.setChannelId(channelId);

        const filter = since ? `createdDateTime gt ${since}` : undefined;
        const rawMessages = await this.client.listChannelMessages({ top: 20, filter });

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
        this.client?.setChannelId(channelId);
    }

    stop(): void {
        this.client = null;
    }
}
