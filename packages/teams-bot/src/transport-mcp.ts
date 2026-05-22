/**
 * McpTransport — TeamsTransport implementation using the Teams MCP server.
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from './types';
import { McpClient } from './mcp-client';

export class McpTransport implements TeamsTransport {
    private client: McpClient | null = null;
    private serverUrl: string;
    private teamId: string | null = null;

    constructor(serverUrl: string) {
        this.serverUrl = serverUrl;
    }

    async initialize(token: string, opts: { teamId?: string; channelId?: string }): Promise<void> {
        this.teamId = opts.teamId ?? null;
        this.client = new McpClient({
            serverUrl: this.serverUrl,
            bearerToken: token,
        });
        await this.client.initialize();
    }

    async send(channelId: string, text: string, opts?: TransportSendOptions): Promise<string> {
        if (!this.client) throw new Error('McpTransport not initialized');

        const args: Record<string, unknown> = {
            teamId: this.teamId,
            channelId,
            content: text,
            contentType: 'html',
        };

        if (opts?.mentions && opts.mentions.length > 0) {
            args['mentions'] = opts.mentions.map((m, idx) => ({
                id: idx,
                mentionText: m.displayName,
                mentioned: { user: { id: m.aadId, displayName: m.displayName } },
            }));
        }

        let toolName: string;
        if (opts?.replyToId) {
            toolName = 'ReplyToChannelMessage';
            args['messageId'] = opts.replyToId;
        } else {
            toolName = 'SendMessageToChannel';
        }

        const result = await this.client.callTool(toolName, args);
        const responseText = result.content?.[0]?.text ?? '';
        try {
            const parsed = JSON.parse(responseText);
            return parsed.messageId ?? parsed.id ?? '';
        } catch {
            return responseText;
        }
    }

    async poll(channelId: string, _since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('McpTransport not initialized');

        const args: Record<string, unknown> = {
            teamId: this.teamId,
            channelId,
            top: 5,
        };

        const result = await this.client.callTool('ListChannelMessages', args);
        const responseText = result.content?.[0]?.text ?? '[]';

        let rawMessages: Array<{
            id: string;
            body?: { content?: string };
            text?: string;
            content?: string;
            from?: { user?: { displayName?: string; id?: string; userId?: string }; displayName?: string; userId?: string };
            senderName?: string;
            senderAadId?: string;
            replyToId?: string;
            createdDateTime?: string;
        }> = [];

        try {
            const parsed = JSON.parse(responseText);
            rawMessages = Array.isArray(parsed) ? parsed : (parsed.value ?? parsed.messages ?? []);
        } catch {
            return { messages: [], nextSince: '' };
        }

        // Sort oldest-first
        rawMessages.sort((a, b) => {
            const ta = a.createdDateTime ? new Date(a.createdDateTime).getTime() : 0;
            const tb = b.createdDateTime ? new Date(b.createdDateTime).getTime() : 0;
            return ta - tb;
        });

        const messages: InboundTeamsMessage[] = rawMessages.map(msg => {
            const rawText = msg.body?.content ?? msg.text ?? msg.content ?? '';
            // Strip HTML tags
            const text = rawText
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(p|div|li)>/gi, '\n')
                .replace(/<[^>]*>/g, '')
                .trim();
            return {
                channelId,
                messageId: msg.id,
                text,
                senderName: msg.from?.user?.displayName ?? msg.from?.displayName ?? msg.senderName,
                senderAadId: msg.from?.user?.id ?? msg.from?.userId ?? msg.senderAadId,
                replyToMessageId: msg.replyToId,
            };
        }).filter(m => m.text.length > 0);

        const nextSince = rawMessages.length > 0 ? rawMessages[rawMessages.length - 1].id : '';
        return { messages, nextSince };
    }

    async listChannels(teamId: string): Promise<TeamsChannel[]> {
        if (!this.client) throw new Error('McpTransport not initialized');
        const result = await this.client.callTool('ListChannels', { teamId });
        const responseText = result.content?.[0]?.text ?? '[]';
        try {
            const parsed = JSON.parse(responseText);
            const channels = Array.isArray(parsed) ? parsed : (parsed.channels ?? parsed.value ?? []);
            return channels.map((c: { id: string; displayName: string }) => ({
                id: c.id,
                displayName: c.displayName,
            }));
        } catch {
            return [];
        }
    }

    async resolveTeamAndChannel(teamName: string, channelName: string): Promise<{ teamId: string; channelId: string }> {
        if (!this.client) throw new Error('McpTransport not initialized');

        // Resolve team
        const teamsResult = await this.client.callTool('ListTeams', {});
        const teamsText = teamsResult.content?.[0]?.text ?? '{}';
        let teams: Array<{ id: string; displayName: string }> = [];
        try {
            const parsed = JSON.parse(teamsText);
            teams = parsed.teams ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
        } catch { /* empty */ }

        const team = teams.find(t => t.displayName.toLowerCase() === teamName.toLowerCase());
        if (!team) throw new Error(`Team "${teamName}" not found via MCP`);
        this.teamId = team.id;

        // Resolve channel
        const channelsResult = await this.client.callTool('ListChannels', { teamId: team.id });
        const channelsText = channelsResult.content?.[0]?.text ?? '{}';
        let channels: Array<{ id: string; displayName: string }> = [];
        try {
            const parsed = JSON.parse(channelsText);
            channels = parsed.channels ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
        } catch { /* empty */ }

        const channel = channels.find(c => c.displayName.toLowerCase() === channelName.toLowerCase());
        if (!channel) throw new Error(`Channel "${channelName}" not found via MCP`);

        return { teamId: team.id, channelId: channel.id };
    }

    setToken(token: string): void {
        this.client?.setBearerToken(token);
    }

    setChannelId(_channelId: string): void {
        // MCP doesn't need channel state — passed per-call
    }

    stop(): void {
        this.client = null;
    }
}
