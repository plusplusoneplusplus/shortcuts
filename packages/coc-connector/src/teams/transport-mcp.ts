/**
 * McpTransport — TeamsTransport implementation using the Teams MCP server.
 * Supports both channel messaging and direct chat messaging.
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from './types';
import { McpClient } from './mcp-client';

export class TeamsMcpSendRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TeamsMcpSendRejectedError';
    }
}

function escapeMcpContent(text: string): string {
    return text.replace(/\\/g, '\\\\');
}

export class McpTransport implements TeamsTransport {
    private client: McpClient | null = null;
    private serverUrl: string;
    private teamId: string | null = null;
    private _availableTools: string[] = [];
    private _useChat = false;
    private _chatId: string | null = null;
    private _initMessageId: string | null = null;
    private nextTrackedRoot = 0;
    private readonly replyPages = new Map<string, string>();
    private readonly bufferedReplies = new Map<string, InboundTeamsMessage[]>();
    private static readonly TRACKED_ROOTS_PER_POLL = 5;
    debug = false;

    constructor(
        serverUrl: string,
        private readonly pollChannelReplies: () => boolean = () => false,
        private readonly channelThreadRoots: (channelId: string) => readonly string[] = () => [],
    ) {
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

        try {
            const toolsResult = await this.client.listTools();
            this._availableTools = (toolsResult.tools ?? []).map((t: any) => t.name);
            console.log(`[mcp-transport] Available tools: ${this._availableTools.join(', ')}`);
        } catch (err: any) {
            console.warn(`[mcp-transport] Failed to list tools: ${err.message}`);
        }

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

    /** Get the message ID of the init probe (so the bot can skip it during polling). */
    getInitMessageId(): string | null {
        return this._initMessageId;
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
                    if (parsed.id) {
                        this._initMessageId = parsed.id;
                    }
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
            content: escapeMcpContent(text),
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

        if (result.isError || responseText.startsWith('Error:')) {
            throw new TeamsMcpSendRejectedError(responseText || `${toolName} failed`);
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

        // SendMessageToSelf sends to the logged-in user — no chatId needed
        const toolName = this._availableTools.includes('SendMessageToSelf')
            ? 'SendMessageToSelf'
            : (this._availableTools.includes('SendMessageToChat') ? 'SendMessageToChat' : 'SendMessageToSelf');

        const args: Record<string, unknown> = {
            content: escapeMcpContent(text),
            contentType: 'html',
        };

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

        if (result.isError || responseText.startsWith('Error:')) {
            throw new Error(responseText || `${toolName} failed`);
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
        if (result.isError) throw new Error('Teams channel messages could not be polled');
        const responseText = result.content?.[0]?.text ?? '[]';

        const roots = this.parseMessages(responseText, channelId, true);
        if (!this.pollChannelReplies() || !this._availableTools.includes('ListChannelMessageReplies')) {
            this.replyPages.clear();
            this.bufferedReplies.clear();
            return roots;
        }

        const messages = [...roots.messages];
        const tracked = [...new Set(this.channelThreadRoots(channelId).filter(Boolean))];
        for (const key of this.replyPages.keys()) {
            const [trackedChannel, trackedRoot] = JSON.parse(key) as [string, string];
            if (trackedChannel === channelId && !tracked.includes(trackedRoot)) {
                this.replyPages.delete(key);
                this.bufferedReplies.delete(key);
            }
        }
        const batch: string[] = [];
        if (tracked.length) {
            for (let i = 0; i < Math.min(tracked.length, McpTransport.TRACKED_ROOTS_PER_POLL); i++) {
                batch.push(tracked[(this.nextTrackedRoot + i) % tracked.length]);
            }
            this.nextTrackedRoot = (this.nextTrackedRoot + batch.length) % tracked.length;
        }
        for (const rootId of new Set([...roots.messages.map(root => root.messageId), ...batch])) {
            const key = JSON.stringify([channelId, rootId]);
            const trackedRoot = tracked.includes(rootId);
            const nextLink = trackedRoot ? this.replyPages.get(key) : undefined;
            const replies = await this.client.callTool('ListChannelMessageReplies', {
                teamId: this.teamId, channelId, messageId: rootId,
                ...(nextLink ? { nextLink } : {}),
                maxReplies: 50,
            });
            if (replies.isError) throw new Error('Teams channel replies could not be polled');
            const response = replies.content?.[0]?.text ?? '[]';
            const parsed = this.parseMessages(response, channelId, true, true);
            const pageReplies = parsed.messages
                .filter(reply => reply.messageId !== rootId)
                .map(reply => ({ ...reply, replyToMessageId: rootId }));
            if (trackedRoot) {
                const page: unknown = JSON.parse(response);
                if (page && typeof page === 'object' && !Array.isArray(page)
                    && (page as { hasMoreResults?: unknown }).hasMoreResults === true) {
                    const cursor = (page as { nextLink?: unknown }).nextLink;
                    if (typeof cursor !== 'string' || !cursor) throw new Error('Teams reply page cursor is missing');
                    this.replyPages.set(key, cursor);
                    this.bufferedReplies.set(key, [...(this.bufferedReplies.get(key) ?? []), ...pageReplies]);
                    continue;
                } else {
                    this.replyPages.delete(key);
                }
            }
            messages.push(...(this.bufferedReplies.get(key) ?? []), ...pageReplies);
            this.bufferedReplies.delete(key);
        }
        messages.sort((a, b) => {
            const left = a.createdDateTime ? Date.parse(a.createdDateTime) : 0;
            const right = b.createdDateTime ? Date.parse(b.createdDateTime) : 0;
            return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
        });
        return { messages, nextSince: roots.nextSince };
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
    private parseMessages(responseText: string, targetId: string, strict = false, allowReplies = false): { messages: InboundTeamsMessage[]; nextSince: string } {

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
            const list = Array.isArray(parsed) ? parsed
                : (parsed?.value ?? parsed?.messages ?? (allowReplies ? parsed?.replies : undefined));
            if (!Array.isArray(list)) throw new Error('Invalid Teams message list');
            rawMessages = list;
        } catch (error) {
            if (strict) throw new Error('Invalid Teams message list', { cause: error });
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
                ...(msg.createdDateTime ? { createdDateTime: msg.createdDateTime } : {}),
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
