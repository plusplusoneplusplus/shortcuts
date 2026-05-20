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
    teamId: string;
    /** Channel ID (e.g., "19:...@thread.tacv2"). */
    channelId?: string;
    /** Chat ID for 1:1 or group chats. */
    chatId?: string;
    /** Graph API base URL (default: https://graph.microsoft.com/v1.0). */
    graphBaseUrl?: string;
}

export interface GraphMessage {
    id: string;
    body: { content: string; contentType?: string };
    from?: { user?: { displayName?: string; id?: string } };
    createdDateTime: string;
    replyToId?: string;
}

interface GraphListResponse {
    value: GraphMessage[];
    '@odata.nextLink'?: string;
}

export class GraphClient {
    private readonly graphBase: string;
    private bearerToken: string;
    private readonly teamId: string;
    private channelId: string | null;
    private chatId: string | null;

    constructor(opts: GraphClientOptions) {
        this.graphBase = opts.graphBaseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
        this.bearerToken = opts.bearerToken;
        this.teamId = opts.teamId;
        this.channelId = opts.channelId ?? null;
        this.chatId = opts.chatId ?? null;
    }

    /** Update the bearer token (e.g., after refresh). */
    setBearerToken(token: string): void {
        this.bearerToken = token;
    }

    /** Update the target channel. */
    setChannelId(channelId: string): void {
        this.channelId = channelId;
    }

    /** Update the target chat. */
    setChatId(chatId: string): void {
        this.chatId = chatId;
    }

    /** Post a message to the configured channel. Returns the message ID. */
    async postChannelMessage(content: string): Promise<string> {
        if (!this.channelId) throw new Error('No channelId configured');
        const url = `${this.graphBase}/teams/${this.teamId}/channels/${encodeURIComponent(this.channelId)}/messages`;
        const res = await this.post(url, { body: { content } });
        return res.id;
    }

    /** Reply to a thread in the configured channel. Returns the reply message ID. */
    async replyToChannelMessage(parentMessageId: string, content: string): Promise<string> {
        if (!this.channelId) throw new Error('No channelId configured');
        const url = `${this.graphBase}/teams/${this.teamId}/channels/${encodeURIComponent(this.channelId)}/messages/${parentMessageId}/replies`;
        const res = await this.post(url, { body: { content } });
        return res.id;
    }

    /** Post a message to a 1:1 or group chat. Returns the message ID. */
    async postChatMessage(content: string, chatId?: string): Promise<string> {
        const target = chatId ?? this.chatId;
        if (!target) throw new Error('No chatId configured');
        const url = `${this.graphBase}/chats/${target}/messages`;
        const res = await this.post(url, { body: { content } });
        return res.id;
    }

    /**
     * List recent channel messages (for polling).
     * @param top Number of messages to fetch (default: 20).
     * @param filter OData filter (e.g., "createdDateTime gt 2026-05-19T00:00:00Z").
     */
    async listChannelMessages(opts?: { top?: number; filter?: string }): Promise<GraphMessage[]> {
        if (!this.channelId) throw new Error('No channelId configured');
        const params = new URLSearchParams();
        if (opts?.top) params.set('$top', String(opts.top));
        if (opts?.filter) params.set('$filter', opts.filter);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const url = `${this.graphBase}/teams/${this.teamId}/channels/${encodeURIComponent(this.channelId)}/messages${qs}`;
        const data = await this.get<GraphListResponse>(url);
        return data.value ?? [];
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
    async listChannels(): Promise<Array<{ id: string; displayName: string }>> {
        const url = `${this.graphBase}/teams/${this.teamId}/channels`;
        const data = await this.get<{ value: Array<{ id: string; displayName: string }> }>(url);
        return data.value ?? [];
    }

    /** Verify connectivity by fetching team info. */
    async verifyConnection(): Promise<void> {
        const url = `${this.graphBase}/teams/${this.teamId}`;
        await this.get(url);
    }

    private async post(url: string, body: unknown): Promise<GraphMessage> {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Graph API POST ${res.status}: ${text}`);
        }
        return await res.json() as GraphMessage;
    }

    private async get<T>(url: string): Promise<T> {
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${this.bearerToken}` },
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Graph API GET ${res.status}: ${text}`);
        }
        return await res.json() as T;
    }
}
