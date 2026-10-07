/**
 * GraphClient — send and receive Teams messages via Microsoft Graph API.
 *
 * This is the primary transport for the CoC Teams bridge. It uses an access token
 * obtained via `az account get-access-token --resource https://graph.microsoft.com`
 * (Azure CLI client ID: 04b07795-8ddb-461a-bbee-02f9e1bf7b46).
 *
 * Unlike the Teams MCP server (which requires McpServers.Teams.All scope preauthorized
 * only for first-party Microsoft apps), Graph API works with any Entra ID app/token
 * that has the required Teams Graph permissions.
 */

export interface GraphClientOptions {
    /** Bearer token for Microsoft Graph API. */
    bearerToken: string;
    /** Team ID (GUID). */
    teamId?: string;
    /** Channel ID (e.g., "19:...@thread.tacv2"). */
    channelId?: string;
    /** Chat ID for 1:1 or group chats. */
    chatId?: string;
    /** Graph API base URL (default: https://graph.microsoft.com/v1.0). */
    graphBaseUrl?: string;
}

/** Native Teams file/card metadata; thumbnails are not incoming image attachments. */
export interface GraphMessageAttachment {
    id?: string;
    contentType: string;
    contentUrl?: string | null;
    name?: string | null;
    thumbnailUrl?: string | null;
}

export interface GraphMessage {
    id: string;
    body: { content: string; contentType?: string };
    from?: { user?: { displayName?: string; id?: string }; application?: { id?: string } };
    createdDateTime: string;
    lastModifiedDateTime?: string;
    replyToId?: string;
    attachments?: GraphMessageAttachment[] | null;
}

export interface GraphTeam {
    id: string;
    displayName: string;
    description?: string;
}

export interface GraphChannel {
    id: string;
    displayName: string;
    description?: string;
}

export interface GraphListResponse {
    value: GraphMessage[];
    '@odata.nextLink'?: string;
}

export interface GraphWriteOptions {
    contentType?: 'text' | 'html';
    signal?: AbortSignal;
}

export interface GraphChannelWriteOptions extends GraphWriteOptions {
    teamId: string;
    channelId: string;
}

/** A received HTTP response, distinct from an ambiguous transport failure. */
export class GraphHttpError extends Error {
    readonly retryAfterMs?: number;

    constructor(readonly status: number, retryAfter?: string | null, message = `Graph API POST ${status}`) {
        super(message);
        this.name = 'GraphHttpError';
        if (retryAfter?.trim()) {
            const seconds = Number(retryAfter);
            const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(delay)) this.retryAfterMs = Math.max(0, delay);
        }
    }
}

export class GraphProtocolError extends Error {
    constructor() {
        super('Graph returned an invalid message response');
        this.name = 'GraphProtocolError';
    }
}

export class GraphClient {
    private readonly graphBase: string;
    private bearerToken: string;
    private teamId: string | null;
    private channelId: string | null;
    private chatId: string | null;
    private _meCache: { id: string; displayName: string } | null = null;

    constructor(opts: GraphClientOptions) {
        this.graphBase = opts.graphBaseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
        this.bearerToken = opts.bearerToken;
        this.teamId = opts.teamId ?? null;
        this.channelId = opts.channelId ?? null;
        this.chatId = opts.chatId ?? null;
    }

    /** Update the bearer token (e.g., after refresh). */
    setBearerToken(token: string): void {
        this.bearerToken = token;
    }

    /** Update the target team. */
    setTeamId(teamId: string): void {
        this.teamId = teamId;
    }

    /** Update the target channel. */
    setChannelId(channelId: string): void {
        this.channelId = channelId;
    }

    /** Update the target chat. */
    setChatId(chatId: string): void {
        this.chatId = chatId;
    }

    /** Get current team ID. */
    getTeamId(): string | null {
        return this.teamId;
    }

    /** Get current channel ID. */
    getChannelId(): string | null {
        return this.channelId;
    }

    /** Get current chat ID. */
    getChatId(): string | null {
        return this.chatId;
    }

    // ── Chat (1:1 / self) discovery & creation ───────────────────

    /** Get the authenticated user's ID and display name (cached). */
    async getMe(): Promise<{ id: string; displayName: string }> {
        if (this._meCache) return this._meCache;
        this._meCache = await this.get<{ id: string; displayName: string }>(`${this.graphBase}/me`);
        return this._meCache;
    }

    /**
     * Find or create a 1:1 chat between the authenticated user and a target user.
     * For a "self-chat" (messaging yourself), pass the current user's ID.
     */
    async getOrCreateChat(targetUserId: string): Promise<string> {
        const me = await this.getMe();

        // List existing chats once
        const chats = await this.get<{ value: Array<{ id: string; chatType: string; members: Array<{ userId?: string }> }> }>(
            `${this.graphBase}/me/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`
        );

        for (const chat of chats.value ?? []) {
            const memberIds = chat.members?.map((m: any) => m.userId).filter(Boolean) ?? [];

            if (targetUserId === me.id) {
                // Self-chat: all members are the current user
                const allSelf = memberIds.length > 0 && memberIds.every(id => id === me.id);
                if (allSelf) {
                    this.chatId = chat.id;
                    return chat.id;
                }
            }

            // Regular 1:1 with target user
            if (memberIds.includes(targetUserId)) {
                this.chatId = chat.id;
                return chat.id;
            }
        }

        // Create a new 1:1 chat — must include both members
        const members: any[] = [
            {
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                roles: ['owner'],
                'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${me.id}')`,
            },
            {
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                roles: ['owner'],
                'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${targetUserId}')`,
            },
        ];

        const res = await fetch(`${this.graphBase}/chats`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chatType: 'oneOnOne',
                members,
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Graph API create chat ${res.status}: ${text}`);
        }

        const data = await res.json() as { id: string };
        this.chatId = data.id;
        return data.id;
    }

    // ── Team/Channel discovery & creation ─────────────────────

    /** List teams the authenticated user has joined. */
    async listJoinedTeams(): Promise<GraphTeam[]> {
        const url = `${this.graphBase}/me/joinedTeams`;
        const data = await this.get<{ value: GraphTeam[] }>(url);
        return data.value ?? [];
    }

    /** Find a team by display name (case-insensitive). */
    async findTeamByName(name: string): Promise<GraphTeam | undefined> {
        const teams = await this.listJoinedTeams();
        return teams.find(t => t.displayName.toLowerCase() === name.toLowerCase());
    }

    /**
     * Create a new team. Returns the team ID.
     * Note: Team creation is async in Graph — the team may not be immediately available.
     */
    async createTeam(displayName: string, description?: string): Promise<string> {
        const url = `${this.graphBase}/teams`;
        const body = {
            'template@odata.bind': `${this.graphBase}/teamsTemplates('standard')`,
            displayName,
            description: description ?? `CoC Teams bridge — ${displayName}`,
        };
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (res.status === 202) {
            // Async creation — extract team ID from Content-Location header
            const location = res.headers.get('Content-Location') ?? '';
            const match = location.match(/teams\('([^']+)'\)/);
            if (match) return match[1];
            // Fallback: poll teamsAsyncOperation from location header
            const teamId = await this.waitForTeamCreation(res.headers.get('Location'));
            if (teamId) return teamId;
            throw new Error('Team creation accepted but could not determine team ID');
        }

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Graph API create team ${res.status}: ${text}`);
        }

        const data = await res.json() as GraphTeam;
        return data.id;
    }

    /** Wait for async team creation to complete. */
    private async waitForTeamCreation(operationUrl: string | null): Promise<string | null> {
        if (!operationUrl) return null;
        const maxAttempts = 30;
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const res = await fetch(operationUrl, {
                    headers: { 'Authorization': `Bearer ${this.bearerToken}` },
                });
                if (!res.ok) continue;
                const data = await res.json() as { status: string; targetResourceId?: string };
                if (data.status === 'succeeded' && data.targetResourceId) {
                    return data.targetResourceId;
                }
                if (data.status === 'failed') {
                    throw new Error('Team creation failed');
                }
            } catch (e: any) {
                if (e.message === 'Team creation failed') throw e;
            }
        }
        return null;
    }

    /** Find a channel by display name within the configured team. */
    async findChannelByName(name: string, teamId?: string): Promise<GraphChannel | undefined> {
        const tid = teamId ?? this.teamId;
        if (!tid) throw new Error('No teamId configured');
        const channels = await this.listChannels(tid);
        return channels.find(c => c.displayName.toLowerCase() === name.toLowerCase());
    }

    /** Create a channel in the team. Returns the channel ID. */
    async createChannel(displayName: string, teamId?: string, description?: string): Promise<string> {
        const tid = teamId ?? this.teamId;
        if (!tid) throw new Error('No teamId configured');
        const url = `${this.graphBase}/teams/${tid}/channels`;
        const res = await this.post(url, {
            displayName,
            description: description ?? `CoC bridge channel — ${displayName}`,
        });
        return res.id;
    }

    /**
     * Resolve team and channel by name, creating them if they don't exist.
     * Updates internal teamId and channelId.
     * Returns the resolved IDs.
     */
    async resolveOrCreateTeamAndChannel(teamName: string, channelName: string): Promise<{ teamId: string; channelId: string }> {
        let team = await this.findTeamByName(teamName);
        if (!team) {
            console.log(`[graph-client] Team "${teamName}" not found, creating...`);
            const teamId = await this.createTeam(teamName);
            // Wait a moment for team to be provisioned
            await new Promise(r => setTimeout(r, 3000));
            this.teamId = teamId;
        } else {
            this.teamId = team.id;
        }

        let channel = await this.findChannelByName(channelName, this.teamId!);
        if (!channel) {
            console.log(`[graph-client] Channel "${channelName}" not found, creating...`);
            const channelId = await this.createChannel(channelName, this.teamId!);
            this.channelId = channelId;
        } else {
            this.channelId = channel.id;
        }

        return { teamId: this.teamId!, channelId: this.channelId! };
    }

    // ── Messaging ─────────────────────────────────────────────

    /** A single authoritative root/reply page; cursors stay scoped to this collection. */
    async listChannelMessagePage(teamId: string, channelId: string, rootId?: string,
        nextLink?: string, signal?: AbortSignal, top = 50): Promise<GraphListResponse> {
        const collection = `${this.graphBase}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}`
            + '/messages' + (rootId ? `/${encodeURIComponent(rootId)}/replies` : '');
        const url = new URL(nextLink ?? `${collection}?$top=${top}`);
        const path = url.pathname.split('/');
        const expectedPath = new URL(collection).pathname.split('/');
        if (url.origin !== new URL(this.graphBase).origin || path.length !== expectedPath.length
            || path.some((segment, index) => decodeURIComponent(segment) !== decodeURIComponent(expectedPath[index]))
            || url.username || url.password || url.hash) throw new GraphProtocolError();
        signal?.throwIfAborted();
        let page: GraphListResponse;
        try { page = await this.get<GraphListResponse>(url.href, signal); }
        catch (error) {
            if (error instanceof SyntaxError) throw new GraphProtocolError();
            throw error;
        }
        signal?.throwIfAborted();
        if (!page || !Array.isArray(page.value) || page.value.some(message =>
            !message || typeof message.id !== 'string' || !message.id.trim()
            || (message.createdDateTime !== undefined && typeof message.createdDateTime !== 'string')
            || (message.body !== undefined && (typeof message.body !== 'object' || message.body === null
                || typeof message.body.content !== 'string')))
            || (page['@odata.nextLink'] !== undefined
                && (typeof page['@odata.nextLink'] !== 'string' || !page['@odata.nextLink']))) {
            throw new GraphProtocolError();
        }
        return page;
    }

    /** Post a message to the configured channel. Returns the message ID. */
    async postChannelMessage(content: string, mentions?: Array<{ aadId: string; displayName: string }>, options?: GraphChannelWriteOptions): Promise<string> {
        const channelId = options ? options.channelId : this.channelId;
        const teamId = options ? options.teamId : this.teamId;
        if (!channelId) throw new Error('No channelId configured');
        if (!teamId) throw new Error('No teamId configured');
        const url = `${this.graphBase}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`;
        const body: Record<string, unknown> = { body: { content, contentType: options?.contentType ?? 'html' } };
        if (mentions && mentions.length > 0) {
            body['mentions'] = mentions.map((m, idx) => ({
                id: idx,
                mentionText: m.displayName,
                mentioned: { user: { id: m.aadId, displayName: m.displayName } },
            }));
        }
        const res = await this.post(url, body, options?.signal);
        return res.id;
    }

    /** Reply to a thread in the configured channel. Returns the reply message ID. */
    async replyToChannelMessage(parentMessageId: string, content: string, mentions?: Array<{ aadId: string; displayName: string }>, options?: GraphChannelWriteOptions): Promise<string> {
        const channelId = options ? options.channelId : this.channelId;
        const teamId = options ? options.teamId : this.teamId;
        if (!channelId) throw new Error('No channelId configured');
        if (!teamId) throw new Error('No teamId configured');
        const url = `${this.graphBase}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(parentMessageId)}/replies`;
        const body: Record<string, unknown> = { body: { content, contentType: options?.contentType ?? 'html' } };
        if (mentions && mentions.length > 0) {
            body['mentions'] = mentions.map((m, idx) => ({
                id: idx,
                mentionText: m.displayName,
                mentioned: { user: { id: m.aadId, displayName: m.displayName } },
            }));
        }
        const res = await this.post(url, body, options?.signal);
        return res.id;
    }

    /** Set Teams' native thumbs-up reaction on a channel root or reply. */
    async reactToChannelMessage(messageId: string, replyToMessageId?: string, options?: GraphChannelWriteOptions): Promise<void> {
        const channelId = options ? options.channelId : this.channelId;
        const teamId = options ? options.teamId : this.teamId;
        if (!channelId || !teamId) throw new Error('Teams channel Like reaction unavailable: no channel');
        const rootId = replyToMessageId ?? messageId;
        const url = `${this.graphBase}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}`
            + `/messages/${encodeURIComponent(rootId)}`
            + (replyToMessageId ? `/replies/${encodeURIComponent(messageId)}` : '')
            + '/setReaction';
        const signal = options?.signal ?? AbortSignal.timeout(5_000);
        try {
            signal.throwIfAborted();
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + this.bearerToken,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ reactionType: '👍' }),
                signal,
            });
            if (response.status !== 204) {
                await response.body?.cancel();
                throw new GraphHttpError(response.status, response.headers?.get('Retry-After'),
                    `Teams channel Like reaction rejected (HTTP ${response.status})`);
            }
        } catch (error) {
            if (signal.aborted) throw new Error('Teams channel Like reaction timed out', { cause: error });
            throw error;
        }
    }

    /** Post a message to a 1:1 or group chat. Returns the message ID. */
    async postChatMessage(content: string, chatId?: string, options?: GraphWriteOptions): Promise<string> {
        const target = chatId ?? this.chatId;
        if (!target) throw new Error('No chatId configured');
        const url = `${this.graphBase}/chats/${encodeURIComponent(target)}/messages`;
        const res = await this.post(url, { body: { content, contentType: options?.contentType ?? 'html' } }, options?.signal);
        return res.id;
    }

    /**
     * List recent channel messages (for polling).
     * @param top Number of messages to fetch (default: 20).
     */
    async listChannelMessages(opts?: { top?: number; pageSince?: string; signal?: AbortSignal }): Promise<GraphMessage[]> {
        if (!this.channelId) throw new Error('No channelId configured');
        if (!this.teamId) throw new Error('No teamId configured');
        const params = new URLSearchParams();
        if (opts?.top) params.set('$top', String(opts.top));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const url = `${this.graphBase}/teams/${this.teamId}/channels/${encodeURIComponent(this.channelId)}/messages${qs}`;
        let next: string | undefined = url;
        const messages: GraphMessage[] = [];
        const visited = new Set<string>();
        while (next) {
            const parsed = new URL(next);
            if (parsed.origin !== new URL(this.graphBase).origin || parsed.username || parsed.password
                || visited.has(next) || visited.size >= 100) throw new GraphProtocolError();
            visited.add(next);
            const data: GraphListResponse = await this.get<GraphListResponse>(next, opts?.signal);
            if (!Array.isArray(data.value)) throw new GraphProtocolError();
            messages.push(...data.value);
            if (opts?.pageSince === undefined || (data.value.length > 0 && data.value.every(message =>
                Date.parse(message.lastModifiedDateTime ?? message.createdDateTime) <= Date.parse(opts.pageSince!)))) break;
            next = data['@odata.nextLink'];
        }
        return messages;
    }

    /**
     * List recent chat messages (for polling).
     */
    async listChatMessages(chatId?: string, opts?: { top?: number; orderby?: string }): Promise<GraphMessage[]> {
        const target = chatId ?? this.chatId;
        if (!target) throw new Error('No chatId configured');
        const params = new URLSearchParams();
        if (opts?.top) params.set('$top', String(opts.top));
        if (opts?.orderby) params.set('$orderby', opts.orderby);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const url = `${this.graphBase}/chats/${target}/messages${qs}`;
        const data = await this.get<GraphListResponse>(url);
        return data.value ?? [];
    }

    /** List channels in the team. */
    async listChannels(teamId?: string): Promise<Array<{ id: string; displayName: string }>> {
        const tid = teamId ?? this.teamId;
        if (!tid) throw new Error('No teamId configured');
        const url = `${this.graphBase}/teams/${tid}/channels`;
        const data = await this.get<{ value: Array<{ id: string; displayName: string }> }>(url);
        return data.value ?? [];
    }

    /** Verify connectivity by fetching team info. */
    async verifyConnection(): Promise<void> {
        if (!this.teamId) throw new Error('No teamId configured');
        const url = `${this.graphBase}/teams/${this.teamId}`;
        await this.get(url);
    }

    private async post(url: string, body: unknown, signal?: AbortSignal): Promise<GraphMessage> {
        signal?.throwIfAborted();
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
        });
        if (!res.ok) {
            await res.body?.cancel();
            throw new GraphHttpError(res.status, res.headers?.get('Retry-After'));
        }
        try {
            const result = await res.json() as GraphMessage;
            if (!result || typeof result.id !== 'string' || !result.id.trim()) throw new GraphProtocolError();
            return result;
        } catch (error) {
            if (error instanceof SyntaxError) throw new GraphProtocolError();
            throw error;
        }
    }

    private async get<T>(url: string, signal?: AbortSignal): Promise<T> {
        const res = await fetch(url, {
            method: 'GET',
            ...(signal ? { signal } : {}),
            headers: { 'Authorization': `Bearer ${this.bearerToken}` },
        });
        if (!res.ok) {
            await res.body?.cancel();
            throw new GraphHttpError(res.status, res.headers?.get('Retry-After'), `Graph API GET ${res.status}`);
        }
        return await res.json() as T;
    }
}
