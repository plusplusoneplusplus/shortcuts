/**
 * McpTransport — TeamsTransport implementation using the Teams MCP server.
 * Supports both channel messaging and direct chat messaging.
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from './types';
import { McpClient } from './mcp-client';

export class McpTransport implements TeamsTransport {
    private client: McpClient | null = null;
    private serverUrl: string;
    private teamId: string | null = null;
    private _availableTools: string[] = [];
    private _useChat = false;
    private _chatId: string | null = null;
    debug = false;

    constructor(serverUrl: string) {
        this.serverUrl = serverUrl;
    }

    async initialize(token: string, opts: { teamId?: string; channelId?: string; chatId?: string }): Promise<void> {
        this.teamId = opts.teamId ?? null;
        console.log(`[mcp-transport] Initializing with teamId=${this.teamId}, serverUrl=${this.serverUrl}`);
        this.client = new McpClient({
            serverUrl: this.serverUrl,
            bearerToken: token,
        });
        await this.client.initialize();

        // Discover available tools
        try {
            const toolsResult = await this.client.listTools();
            this._availableTools = (toolsResult.tools ?? []).map((t: any) => t.name);
            console.log(`[mcp-transport] Available tools: ${this._availableTools.join(', ')}`);
        } catch (err: any) {
            console.warn(`[mcp-transport] Failed to list tools: ${err.message}`);
        }

        // If no teamId configured, use chat mode for DM
        if (!this.teamId) {
            this._useChat = true;
            console.log(`[mcp-transport] No teamId — using direct message (self) mode`);
            console.log(`[mcp-transport] Will use SendMessageToSelf tool to send messages to the authenticated user`);

            // Discover self-chatId for polling (sends still use SendMessageToSelf)
            await this.discoverSelfChatForPolling();
        }

        console.log(`[mcp-transport] MCP session initialized successfully (mode=${this._useChat ? 'self-dm' : 'channel'}, pollTarget=${this._chatId ?? 'pending'})`);
    }

    /** Get discovered chat ID for DM mode (used as poll target). */
    getChatId(): string | null {
        return this._chatId;
    }

    /**
     * Discover the self-chat ID for polling purposes.
     * Sends a brief init message via SendMessageToSelf to get the chatId from the response.
     */
    private async discoverSelfChatForPolling(): Promise<void> {
        if (!this.client) return;

        // Send a brief init message to discover the chatId
        if (this._availableTools.includes('SendMessageToSelf')) {
            try {
                const result = await this.client.callTool('SendMessageToSelf', {
                    content: '🤖 CoC bridge connected',
                    contentType: 'text',
                });
                const responseText = result.content?.[0]?.text ?? '';
                console.log(`[mcp-transport] SendMessageToSelf init response: ${responseText.substring(0, 200)}`);

                if (!responseText.startsWith('Error:')) {
                    const parsed = JSON.parse(responseText);
                    if (parsed.chatId) {
                        this._chatId = parsed.chatId;
                        console.log(`[mcp-transport] Discovered self-chat for polling: ${this._chatId}`);
                        return;
                    }
                }
            } catch (err: any) {
                console.warn(`[mcp-transport] SendMessageToSelf init failed: ${err.message}`);
            }
        }

        // Fallback: use ListChats to find a chat
        if (this._availableTools.includes('ListChats')) {
            try {
                const result = await this.client.callTool('ListChats', {});
                const responseText = result.content?.[0]?.text ?? '[]';
                const parsed = JSON.parse(responseText);
                const chats = Array.isArray(parsed) ? parsed : (parsed.value ?? parsed.chats ?? []);
                if (chats.length > 0) {
                    // Use first oneOnOne chat (likely the self-chat since we just sent a message there)
                    const selfChat = chats.find((c: any) => c.chatType === 'oneOnOne' || c.type === 'oneOnOne');
                    this._chatId = selfChat?.id ?? chats[0].id;
                    console.log(`[mcp-transport] Using chat for polling: ${this._chatId}`);
                }
            } catch (err: any) {
                console.warn(`[mcp-transport] ListChats fallback failed: ${err.message}`);
            }
        }
    }

    async send(channelId: string, text: string, opts?: TransportSendOptions): Promise<string> {
        if (!this.client) throw new Error('McpTransport not initialized');

        // In chat mode, use SendChatMessage or SendMessageToChat
        if (this._useChat) {
            return this.sendChat(channelId, text);
        }

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

        console.log(`[mcp-transport] Calling ${toolName} with teamId=${this.teamId}, channelId=${channelId}, content length=${text.length}`);
        const result = await this.client.callTool(toolName, args);
        const responseText = result.content?.[0]?.text ?? '';
        console.log(`[mcp-transport] ${toolName} response: ${responseText.substring(0, 200)}`);

        if (responseText.startsWith('Error:')) {
            throw new Error(responseText);
        }

        try {
            const parsed = JSON.parse(responseText);
            return parsed.messageId ?? parsed.id ?? '';
        } catch {
            return responseText;
        }
    }

    /** Send a direct message to the authenticated user via SendMessageToSelf. */
    private async sendChat(_chatId: string, text: string): Promise<string> {
        if (!this.client) throw new Error('McpTransport not initialized');

        // Escape backslashes — the MCP server rejects unrecognized escape sequences in content
        const sanitizedText = text.replace(/\\/g, '\\\\');

        // SendMessageToSelf sends to the logged-in user — no chatId needed
        const toolName = this._availableTools.includes('SendMessageToSelf')
            ? 'SendMessageToSelf'
            : (this._availableTools.includes('SendMessageToChat') ? 'SendMessageToChat' : 'SendMessageToSelf');

        const args: Record<string, unknown> = {
            content: sanitizedText,
            contentType: 'html',
        };

        // If using SendMessageToChat, include chatId
        if (toolName === 'SendMessageToChat' && _chatId) {
            args['chatId'] = _chatId;
        }

        console.log(`[mcp-transport] *** SENDING DM TO SELF ***`);
        console.log(`[mcp-transport]   Tool: ${toolName}`);
        console.log(`[mcp-transport]   Recipient: authenticated user (self — the account used to login to Teams MCP)`);
        console.log(`[mcp-transport]   Content length: ${text.length}`);
        console.log(`[mcp-transport]   Content preview: ${text.substring(0, 100)}...`);

        const result = await this.client.callTool(toolName, args);
        const responseText = result.content?.[0]?.text ?? '';
        console.log(`[mcp-transport] ${toolName} response: ${responseText.substring(0, 200)}`);

        if (responseText.startsWith('Error:')) {
            throw new Error(responseText);
        }

        try {
            const parsed = JSON.parse(responseText);
            const messageId = parsed.messageId ?? parsed.id ?? '';
            // Capture chatId from response for polling if not yet known
            if (!this._chatId && parsed.chatId) {
                this._chatId = parsed.chatId;
                console.log(`[mcp-transport] Captured chatId from send response: ${this._chatId}`);
            }
            console.log(`[mcp-transport] *** DM SENT SUCCESSFULLY *** messageId=${messageId}`);
            return messageId;
        } catch {
            return responseText;
        }
    }

    async poll(channelId: string, _since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('McpTransport not initialized');

        if (this._useChat) {
            return this.pollChat(channelId, _since);
        }

        const args: Record<string, unknown> = {
            teamId: this.teamId,
            channelId,
            top: 5,
        };

        const result = await this.client.callTool('ListChannelMessages', args);
        const responseText = result.content?.[0]?.text ?? '[]';

        return this.parseMessages(responseText, channelId);
    }

    /** Poll chat messages via MCP. */
    private async pollChat(chatId: string, _since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('McpTransport not initialized');

        // Try known tool names for listing chat messages
        const chatListTools = ['ListChatMessages', 'GetChatMessages', 'list_chat_messages'];
        const toolName = chatListTools.find(t => this._availableTools.includes(t))
            ?? 'ListChatMessages'; // default guess

        const args: Record<string, unknown> = {
            chatId,
            top: 5,
        };

        const result = await this.client.callTool(toolName, args);
        const responseText = result.content?.[0]?.text ?? '[]';

        return this.parseMessages(responseText, chatId);
    }

    /** Parse raw MCP message response into InboundTeamsMessage array. */
    private parseMessages(responseText: string, targetId: string): { messages: InboundTeamsMessage[]; nextSince: string } {

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
            [key: string]: unknown;
        }> = [];

        try {
            const parsed = JSON.parse(responseText);
            rawMessages = Array.isArray(parsed) ? parsed : (parsed.value ?? parsed.messages ?? []);
        } catch {
            return { messages: [], nextSince: '' };
        }

        // Debug: log raw message keys for diagnosing reply routing
        if (this.debug) {
            for (const msg of rawMessages) {
                const keys = Object.keys(msg).join(', ');
                const rawBody = msg.body?.content ?? '';
                console.log(`[mcp-transport] Raw message id=${msg.id}: keys=[${keys}], replyToId=${msg.replyToId ?? '(undefined)'}`);
                if (rawBody.length > 0 && rawBody.length < 2000) {
                    console.log(`[mcp-transport]   body.content: ${rawBody}`);
                }
                for (const k of Object.keys(msg)) {
                    if (k.toLowerCase().includes('reply') || k.toLowerCase().includes('parent') || k.toLowerCase().includes('quote') || k.toLowerCase().includes('attach') || k.toLowerCase().includes('mention')) {
                        console.log(`[mcp-transport]   → ${k}=${JSON.stringify((msg as any)[k])}`);
                    }
                }
            }
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
                channelId: targetId,
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

        let team = teams.find(t => t.displayName.toLowerCase() === teamName.toLowerCase());
        if (!team) {
            console.log(`[mcp-transport] Team "${teamName}" not found, creating...`);
            const createResult = await this.client.callTool('CreateTeam', {
                displayName: teamName,
                description: `CoC bridge team — ${teamName}`,
            });
            const createText = createResult.content?.[0]?.text ?? '';
            console.log(`[mcp-transport] CreateTeam response: ${createText.substring(0, 200)}`);
            if (createText.startsWith('Error:')) {
                throw new Error(`Failed to create team "${teamName}": ${createText}`);
            }
            try {
                const created = JSON.parse(createText);
                team = { id: created.id ?? created.teamId, displayName: teamName };
            } catch {
                throw new Error(`Failed to parse CreateTeam response: ${createText}`);
            }
            // Wait for team provisioning
            await new Promise(r => setTimeout(r, 3000));
        }
        this.teamId = team!.id;

        // Resolve channel
        const channelsResult = await this.client.callTool('ListChannels', { teamId: team!.id });
        const channelsText = channelsResult.content?.[0]?.text ?? '{}';
        let channels: Array<{ id: string; displayName: string }> = [];
        try {
            const parsed = JSON.parse(channelsText);
            channels = parsed.channels ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
        } catch { /* empty */ }

        let channel = channels.find(c => c.displayName.toLowerCase() === channelName.toLowerCase());
        if (!channel) {
            console.log(`[mcp-transport] Channel "${channelName}" not found in team "${teamName}", creating...`);
            const createResult = await this.client.callTool('CreateChannel', {
                teamId: team!.id,
                displayName: channelName,
                description: `CoC bridge channel — ${channelName}`,
            });
            const createText = createResult.content?.[0]?.text ?? '';
            console.log(`[mcp-transport] CreateChannel response: ${createText.substring(0, 200)}`);
            if (createText.startsWith('Error:')) {
                throw new Error(`Failed to create channel "${channelName}": ${createText}`);
            }
            try {
                const created = JSON.parse(createText);
                channel = { id: created.id ?? created.channelId, displayName: channelName };
            } catch {
                throw new Error(`Failed to parse CreateChannel response: ${createText}`);
            }
        }

        return { teamId: team!.id, channelId: channel!.id };
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
