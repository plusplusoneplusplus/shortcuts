/**
 * McpTransport — TeamsTransport implementation using the Teams MCP server.
 * Supports both channel messaging and direct chat messaging.
 */

import type { TeamsTransport, InboundTeamsMessage, TeamsChannel, TransportSendOptions } from '../types';
import { McpClient } from './mcp-client';
import type { TeamsReadHints } from '../notification-scheduler';
import { randomUUID } from 'node:crypto';
import type { Ic3DirectMessageOptions } from '../ic3/ic3-direct-message-config';
import { Ic3Operations } from '../ic3/operations-ic3';
import { McpOperations } from './operations-mcp';
import { GraphClient } from '../graph/graph-client';
import { GraphOperations } from '../graph/operations-graph';
import { GraphCredentialStore, type GraphOutboundOptions } from '../graph/graph-credential';
import { GraphChannelReader } from '../graph/channel-reader';
import { RoutedTeamsOperations, TeamsOperationError, type TeamsDestination, type TeamsOperationRoutes, type TeamsOperations } from '../operations';
export { TeamsMcpSendRejectedError } from './operations-mcp';

export interface McpChannelRootPage {
    roots: InboundTeamsMessage[];
    nextLink?: string;
    nextSince: string;
}

function chronologicalMessages(a: InboundTeamsMessage, b: InboundTeamsMessage): number {
    const left = a.createdDateTime ? Date.parse(a.createdDateTime) : 0;
    const right = b.createdDateTime ? Date.parse(b.createdDateTime) : 0;
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
}

function tokenAccount(token: string): { tenantId: string; objectId: string } | undefined {
    try {
        const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (claims && typeof claims === 'object' && 'tid' in claims && 'oid' in claims
            && typeof claims.tid === 'string' && guid.test(claims.tid)
            && typeof claims.oid === 'string' && guid.test(claims.oid)) {
            return { tenantId: claims.tid.toLowerCase(), objectId: claims.oid.toLowerCase() };
        }
    } catch {
        // Opaque MCP credentials cannot establish a hybrid account binding.
    }
    return undefined;
}

export class McpTransport implements TeamsTransport {
    private client: McpClient | null = null;
    private serverUrl: string;
    private teamId: string | null = null;
    private _availableTools: string[] = [];
    private toolsDiscovered = false;
    private outbound: RoutedTeamsOperations | null = null;
    private lifetime = new AbortController();
    private graphCredentials?: GraphCredentialStore;
    private graphReader?: GraphChannelReader;
    readonly connectionId: string;
    private readonly ic3Options: Ic3DirectMessageOptions;
    private account: ReturnType<typeof tokenAccount>;
    private _useChat = false;
    private _chatId: string | null = null;
    private selfChatId: string | null = null;
    private _initMessageId: string | null = null;
    private nextTrackedRoot = 0;
    private readonly rootPages = new Map<string, string>();
    private readonly discoveredRoots = new Map<string, string[]>();
    private readonly discoveredRootIds = new Map<string, Set<string>>();
    private readonly notifiedRootIds = new Map<string, Set<string>>();
    private readonly historicalReplies = new Set<string>();
    private readonly nextDiscoveredRoot = new Map<string, number>();
    private readonly replyPages = new Map<string, string>();
    private readonly bufferedReplies = new Map<string, InboundTeamsMessage[]>();
    private readonly notificationRootWatermarks = new Map<string, string>();
    private readonly pendingNotificationHeads = new Map<string, string>();
    private readonly pendingNotificationReconciliations = new Set<string>();
    private static readonly TRACKED_ROOTS_PER_POLL = 5;
    debug = false;

    constructor(
        serverUrl: string,
        private readonly pollChannelReplies: () => boolean = () => false,
        private readonly channelThreadRoots: (channelId: string) => readonly string[] = () => [],
        private readonly onChannelRootDiscovered?: (root: InboundTeamsMessage) => Promise<void>,
        private readonly enableIc3DirectMessages = false,
        ic3DirectMessageOptions?: Ic3DirectMessageOptions,
        private readonly operationOptions: {
            connectionId?: string;
            routes?: Partial<TeamsOperationRoutes>;
            onTokenRefresh?: () => Promise<string | null>;
            graphOutboundOptions?: GraphOutboundOptions;
            channelReadBackend?: 'mcp' | 'graph';
            graphReadOptions?: GraphOutboundOptions;
        } = {},
    ) {
        this.connectionId = operationOptions.connectionId ?? randomUUID();
        this.operationOptions = { ...operationOptions, routes: { ...operationOptions.routes } };
        this.ic3Options = { ...ic3DirectMessageOptions };
        // Validate immutable IC3 configuration without acquiring credentials.
        new Ic3Operations({ ...this.ic3Options, connectionId: this.connectionId });
        this.serverUrl = serverUrl;
    }

    get operations(): RoutedTeamsOperations {
        if (!this.outbound) throw new Error('McpTransport not initialized');
        return this.outbound;
    }

    private async configureOperations(client: McpClient, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        const mcp = new McpOperations({
            connectionId: this.connectionId, client,
            availableTools: this.toolsDiscovered ? this._availableTools : undefined,
            onTokenRefresh: this.operationOptions.onTokenRefresh && (async () => {
                const refreshed = await this.operationOptions.onTokenRefresh!();
                if (refreshed) this.bindAccount(refreshed);
                return refreshed;
            }),
            onSelfChatResolved: chatId => {
                this.selfChatId = chatId;
                this._chatId ??= chatId;
            },
        });
        const ic3 = new Ic3Operations({
            ...this.ic3Options, connectionId: this.connectionId,
            enableSelfSend: this.enableIc3DirectMessages, expectedAccount: this.account, requireAccountMatch: true,
        });
        const backends: TeamsOperations[] = [mcp, ic3];
        if (this.operationOptions.graphOutboundOptions) {
            const credentials = new GraphCredentialStore(this.account, this.operationOptions.graphOutboundOptions);
            this.graphCredentials = credentials;
            const credential = await credentials.get(AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
            signal.throwIfAborted();
            backends.push(new GraphOperations({
                connectionId: this.connectionId, client: new GraphClient({ bearerToken: credential }),
                acquireToken: writeSignal => credentials.get(writeSignal),
                onTokenRefresh: writeSignal => credentials.get(writeSignal!, true),
            }));
        }
        this.outbound = new RoutedTeamsOperations({
            selfSend: this.enableIc3DirectMessages ? 'ic3' : 'mcp',
            chatSend: 'mcp', channelSend: 'mcp', channelReply: 'mcp', channelLike: 'ic3',
            ...this.operationOptions.routes,
        }, backends);
    }

    private bindAccount(token: string): void {
        const account = tokenAccount(token);
        if (this.account && (this.account.tenantId !== account?.tenantId || this.account.objectId !== account?.objectId)) {
            throw new TeamsOperationError('Teams account changed; create a new connection', 'mcp', 'authentication', 'not-attempted');
        }
        this.account = account;
    }

    hasDiscoveredRoot(channelId: string, rootId: string): boolean {
        return this.discoveredRootIds.get(channelId)?.has(rootId) ?? false;
    }

    /** Fetch one provider page without consuming the poller's backfill cursor. */
    async listChannelRootPage(channelId: string, nextLink?: string, signal?: AbortSignal, top = 5): Promise<McpChannelRootPage> {
        if (!this.client || !this.teamId || this._useChat) throw new Error('MCP channel transport not initialized');
        if (this.operationOptions.channelReadBackend === 'graph' && !this.graphReader) {
            throw new Error('Graph channel reader unavailable; reconnect required');
        }
        if (this.graphReader) {
            const page = await this.graphReader.page(this.teamId, channelId, undefined, nextLink, signal, top);
            return { roots: page.messages, nextLink: page.nextLink, nextSince: page.messages.at(-1)?.messageId ?? '' };
        }
        const result = await this.client.callTool('ListChannelMessages', {
            teamId: this.teamId, channelId,
            ...(nextLink ? { nextLink } : { top }),
        }, signal);
        if (result.isError) throw new Error('Teams channel messages could not be polled');
        const text = result.content?.[0]?.text ?? '[]';
        const parsed = this.parseMessages(text, channelId, true);
        return { roots: parsed.messages, nextSince: parsed.nextSince,
            nextLink: this.pageCursor(JSON.parse(text), 'root') };
    }

    private async notifyRoots(roots: readonly InboundTeamsMessage[], signal?: AbortSignal): Promise<void> {
        if (!this.onChannelRootDiscovered) return;
        for (const root of roots) {
            signal?.throwIfAborted();
            const notified = this.notifiedRootIds.get(root.channelId) ?? new Set<string>();
            if (notified.has(root.messageId)) continue;
            await this.onChannelRootDiscovered(root);
            signal?.throwIfAborted();
            notified.add(root.messageId);
            this.notifiedRootIds.set(root.channelId, notified);
        }
    }

    async initialize(token: string, opts: { teamId?: string; channelId?: string; chatId?: string }): Promise<void> {
        this.lifetime.abort();
        this.lifetime = new AbortController();
        const signal = this.lifetime.signal;
        this.graphCredentials?.clear();
        this.graphCredentials = undefined;
        this.graphReader?.stop();
        this.graphReader = undefined;
        this.bindAccount(token);
        this.teamId = opts.teamId ?? null;
        this._useChat = !this.teamId;
        this._chatId = null;
        this.selfChatId = null;
        this._initMessageId = null;
        void this.outbound?.dispose();
        this.outbound = null;
        console.log(`[mcp-transport] Initializing with teamId=${this.teamId}, serverUrl=${this.serverUrl}`);
        const client = new McpClient({
            serverUrl: this.serverUrl,
            bearerToken: token,
        });
        this.client = client;
        await client.initialize();
        signal.throwIfAborted();

        this._availableTools = [];
        this.toolsDiscovered = false;
        try {
            const toolsResult = await client.listTools();
            signal.throwIfAborted();
            this._availableTools = (toolsResult.tools ?? []).map(t => t.name);
            this.toolsDiscovered = Array.isArray(toolsResult.tools);
            console.log(`[mcp-transport] Available tools: ${this._availableTools.join(', ')}`);
        } catch (err: any) {
            signal.throwIfAborted();
            console.warn(`[mcp-transport] Failed to list tools: ${err.message}`);
        }
        await this.configureOperations(client, signal);
        signal.throwIfAborted();
        if (this.teamId && this.operationOptions.channelReadBackend === 'graph') {
            const reader = new GraphChannelReader(this.account, this.operationOptions.graphReadOptions);
            this.graphReader = reader;
            await reader.initialize();
            signal.throwIfAborted();
        }

        if (!this.teamId) {
            this._useChat = true;
            console.log(`[mcp-transport] No teamId — using direct message (self) mode`);
            console.log(`[mcp-transport] Self-DM sends use ${this.enableIc3DirectMessages ? 'IC3 (48:notes only)' : 'SendMessageToSelf'}`);

            // IC3 notes IDs are not MCP chat IDs. Poll only an explicit MCP target.
            if (this.enableIc3DirectMessages || opts.chatId) {
                this._chatId = opts.chatId ?? null;
            } else {
                await this.discoverSelfChatForPolling();
            }
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
                const result = await this.operations.send({ kind: 'self' }, {
                    content: '🤖 CoC bridge connected',
                    contentType: 'text',
                });
                this._initMessageId = result.message.messageId;
            } catch (err: any) {
                console.warn(`[mcp-transport] SendMessageToSelf init failed: ${err.message}`);
            }
        }
        if (!this._chatId) console.warn('[mcp-transport] Self-chat unresolved; DM polling requires an explicit chat ID');
    }

    async send(channelId: string, text: string, opts?: TransportSendOptions): Promise<string> {
        if (!this.client) throw new Error('McpTransport not initialized');
        const destination: TeamsDestination = this.teamId
            ? { kind: 'channel', teamId: this.teamId, channelId }
            : channelId === '48:notes' || (!this.enableIc3DirectMessages && channelId === this.selfChatId)
                ? { kind: 'self' } : { kind: 'chat', chatId: channelId };
        const body = { content: text, contentType: 'html' as const,
            ...(opts?.mentions !== undefined ? { mentions: opts.mentions.map(m => ({ id: m.aadId, displayName: m.displayName })) } : {}) };
        if (this._useChat && this.enableIc3DirectMessages && destination.kind !== 'self') {
            throw new TeamsOperationError('IC3 direct messages support only self-chat 48:notes',
                'ic3', 'unsupported', 'not-attempted');
        }
        const receipt = opts?.replyToId !== undefined
            ? await this.operations.reply({ destination, messageId: opts.replyToId,
                backend: this.operationOptions.routes?.channelReply ?? 'mcp', connectionId: this.connectionId }, body)
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
            backend: 'mcp', connectionId: this.connectionId,
        }, 'like');
    }

    async poll(channelId: string, _since?: string, hints?: TeamsReadHints): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('McpTransport not initialized');
        if (!this._useChat && this.operationOptions.channelReadBackend === 'graph' && !this.graphReader) {
            throw new Error('Graph channel reader unavailable; reconnect required');
        }

        if (this.graphReader && !hints) hints = { rootMessageIds: [], reconcile: true };
        const signal = hints ? AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000),
            ...(hints.signal ? [hints.signal] : [])]) : undefined;
        signal?.throwIfAborted();
        if (this._useChat) {
            return this.pollChat(channelId, _since, signal);
        }

        const readReplies = this.pollChannelReplies()
            && (!!this.graphReader || this._availableTools.includes('ListChannelMessageReplies'));
        const hintedRoots = hints?.rootMessageIds ?? [];
        const boundRoots = new Set(hints && readReplies ? this.channelThreadRoots(channelId) : []);
        // Known thread wakes need only authoritative replies; fallback scans own root discovery/backfill.
        const targetedRead = !!hints && !hints.reconcile && readReplies && hintedRoots.length > 0
            && !this.pendingNotificationReconciliations.has(channelId)
            && hintedRoots.every(root => boundRoots.has(root) || this.discoveredRootIds.get(channelId)?.has(root));
        if (hints && !targetedRead) this.pendingNotificationReconciliations.add(channelId);
        const roots: McpChannelRootPage = targetedRead
            ? { roots: [], nextSince: _since ?? '' }
            : await this.listChannelRootPage(channelId, undefined, signal, hints ? 50 : 5);
        const newestRoot = roots.roots.at(-1)?.messageId;
        if (hints) {
            const watermark = this.notificationRootWatermarks.get(channelId);
            const visited = new Set<string>();
            let cursor = roots.nextLink;
            while (watermark && !roots.roots.some(root => root.messageId === watermark) && cursor) {
                if (visited.has(cursor) || visited.size >= 100) throw new Error('Teams root pagination limit');
                visited.add(cursor);
                const page = await this.listChannelRootPage(channelId, cursor, signal, 50);
                roots.roots.push(...page.roots);
                if (roots.roots.length > 10_000) throw new Error('Teams notification read limit');
                cursor = page.nextLink;
            }
        }
        roots.roots.sort(chronologicalMessages);
        if (!readReplies) {
            this.replyPages.clear();
            this.bufferedReplies.clear();
            this.rootPages.clear();
            this.discoveredRoots.clear();
            this.discoveredRootIds.clear();
            this.historicalReplies.clear();
            this.nextDiscoveredRoot.clear();
            this.notifiedRootIds.clear();
            if (hints && newestRoot) this.pendingNotificationHeads.set(channelId, newestRoot);
            return { messages: roots.roots, nextSince: roots.nextSince };
        }

        await this.notifyRoots(roots.roots, signal);
        const messages = [...roots.roots];
        const tracked = [...new Set(this.channelThreadRoots(channelId).filter(Boolean))];
        const cursor = roots.nextLink;
        const pendingCursor = this.rootPages.get(channelId) ?? cursor;
        let historicalRoots: InboundTeamsMessage[] = [];
        let followingCursor = cursor;
        if (!targetedRead && pendingCursor) {
            const history = await this.listChannelRootPage(channelId, pendingCursor, signal);
            if (history.nextLink === pendingCursor) throw new Error('Teams root pagination limit');
            historicalRoots = history.roots;
            followingCursor = history.nextLink;
        }
        await this.notifyRoots(historicalRoots.map(root => ({ ...root, initializationReplay: true })), signal);
        const discovered = this.discoveredRoots.get(channelId) ?? [];
        const discoveredIds = this.discoveredRootIds.get(channelId) ?? new Set<string>();
        for (const root of historicalRoots) {
            if (!root.messageId || discoveredIds.has(root.messageId) || tracked.includes(root.messageId)) continue;
            discovered.push(root.messageId);
            discoveredIds.add(root.messageId);
            this.historicalReplies.add(JSON.stringify([channelId, root.messageId]));
        }
        this.discoveredRoots.set(channelId, discovered);
        this.discoveredRootIds.set(channelId, discoveredIds);
        messages.push(...historicalRoots.map(root => ({ ...root, initializationReplay: true })));
        for (const key of this.replyPages.keys()) {
            const [trackedChannel, trackedRoot] = JSON.parse(key) as [string, string];
            if (trackedChannel === channelId && !tracked.includes(trackedRoot)
                && !discoveredIds.has(trackedRoot)) {
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
        const discoveredBatch: string[] = [];
        let discoveredIndex = this.nextDiscoveredRoot.get(channelId) ?? 0;
        for (let i = 0; i < Math.min(discovered.length, McpTransport.TRACKED_ROOTS_PER_POLL); i++) {
            discoveredBatch.push(discovered[(discoveredIndex + i) % discovered.length]);
        }
        discoveredIndex = discovered.length ? (discoveredIndex + discoveredBatch.length) % discovered.length : 0;
        const knownRoots = new Set([...tracked, ...discovered, ...roots.roots.map(root => root.messageId)]);
        const replyRoots = hints
            ? targetedRead ? hintedRoots : [...hintedRoots.filter(root => knownRoots.has(root)), ...knownRoots]
            : [...roots.roots.map(root => root.messageId), ...batch, ...discoveredBatch];
        for (const rootId of new Set(replyRoots)) {
            signal?.throwIfAborted();
            if (hints) {
                const replies = await this.readNotificationReplies(channelId, rootId, signal!);
                if (messages.length + replies.length > 10_000) throw new Error('Teams notification read limit');
                const key = JSON.stringify([channelId, rootId]);
                messages.push(...replies.map(reply => ({
                    ...reply, ...(this.historicalReplies.has(key) ? { initializationReplay: true } : {}),
                })));
                this.historicalReplies.delete(key);
                continue;
            }
            const key = JSON.stringify([channelId, rootId]);
            const trackedRoot = tracked.includes(rootId) || discoveredIds.has(rootId);
            const nextLink = trackedRoot ? this.replyPages.get(key) : undefined;
            const page = await this.listChannelReplyPage(channelId, rootId, nextLink, signal);
            const pageReplies = page.messages
                .filter(reply => reply.messageId !== rootId)
                .map(reply => ({
                    ...reply, replyToMessageId: rootId,
                    ...(this.historicalReplies.has(key) ? { initializationReplay: true } : {}),
                }));
            if (trackedRoot) {
                const replyCursor = page.nextLink;
                if (replyCursor) {
                    this.replyPages.set(key, replyCursor);
                    this.bufferedReplies.set(key, [...(this.bufferedReplies.get(key) ?? []), ...pageReplies]);
                    continue;
                } else {
                    this.replyPages.delete(key);
                }
            }
            messages.push(...(this.bufferedReplies.get(key) ?? []), ...pageReplies);
            this.bufferedReplies.delete(key);
            this.historicalReplies.delete(key);
        }
        if (!targetedRead) {
            this.rootPages.set(channelId, followingCursor ?? '');
            this.nextDiscoveredRoot.set(channelId, discoveredIndex);
        }
        if (hints && newestRoot) this.pendingNotificationHeads.set(channelId, newestRoot);
        messages.sort(chronologicalMessages);
        return { messages, nextSince: roots.nextSince };
    }

    commitNotificationRead(channelId: string): void {
        const head = this.pendingNotificationHeads.get(channelId);
        if (head) this.notificationRootWatermarks.set(channelId, head);
        this.pendingNotificationHeads.delete(channelId);
        this.pendingNotificationReconciliations.delete(channelId);
    }

    private async readNotificationReplies(channelId: string, rootId: string, signal: AbortSignal): Promise<InboundTeamsMessage[]> {
        const messages: InboundTeamsMessage[] = [];
        const visited = new Set<string>();
        let nextLink: string | undefined;
        do {
            signal.throwIfAborted();
            const page = await this.listChannelReplyPage(channelId, rootId, nextLink, signal);
            messages.push(...page.messages
                .filter(reply => reply.messageId !== rootId)
                .map(reply => ({ ...reply, replyToMessageId: rootId })));
            nextLink = page.nextLink;
            if (messages.length > 5000) throw new Error('Teams reply pagination limit');
            if (nextLink) {
                if (visited.has(nextLink) || visited.size >= 100) {
                    throw new Error('Teams reply pagination limit');
                }
                visited.add(nextLink);
            }
        } while (nextLink);
        return messages;
    }

    private async listChannelReplyPage(channelId: string, rootId: string, nextLink?: string, signal?: AbortSignal):
        Promise<{ messages: InboundTeamsMessage[]; nextLink?: string }> {
        if (this.graphReader) return this.graphReader.page(this.teamId!, channelId, rootId, nextLink, signal);
        const result = await this.client!.callTool('ListChannelMessageReplies', {
            teamId: this.teamId, channelId, messageId: rootId, maxReplies: 50,
            ...(nextLink ? { nextLink } : {}),
        }, signal);
        if (result.isError) throw new Error('Teams channel replies could not be read');
        const response = result.content?.[0]?.text ?? '';
        return { messages: this.parseMessages(response, channelId, true, true).messages,
            nextLink: this.pageCursor(JSON.parse(response), 'reply') };
    }

    private pageCursor(page: unknown, kind: 'root' | 'reply'): string | undefined {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return undefined;
        const record = page as { hasMoreResults?: unknown; nextLink?: unknown };
        if (record.hasMoreResults !== true) return undefined;
        if (typeof record.nextLink !== 'string' || !record.nextLink) {
            throw new Error(`Teams ${kind} page cursor is missing`);
        }
        return record.nextLink;
    }

    /** Poll chat messages via MCP. */
    private async pollChat(chatId: string, _since?: string, signal?: AbortSignal): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }> {
        if (!this.client) throw new Error('McpTransport not initialized');

        // Try known tool names for listing chat messages
        const chatListTools = ['ListChatMessages', 'GetChatMessages', 'list_chat_messages'];
        const toolName = chatListTools.find(t => this._availableTools.includes(t))
            ?? 'ListChatMessages'; // default guess

        const args: Record<string, unknown> = {
            chatId,
            top: 5,
        };

        const result = await this.client.callTool(toolName, args, signal);
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
            from?: { user?: { displayName?: string; id?: string; userId?: string }; application?: unknown; displayName?: string; userId?: string };
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
            if (strict && list.some(msg => !msg || typeof msg.id !== 'string' || !msg.id)) {
                throw new Error('Invalid Teams message id');
            }
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
                botAuthored: !!msg.from?.application,
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
        this.bindAccount(token);
        this.client?.setBearerToken(token);
    }

    setChannelId(_channelId: string): void {
        // MCP doesn't need channel state — passed per-call
    }

    stop(): void {
        this.lifetime.abort();
        this.graphReader?.stop();
        this.graphReader = undefined;
        this.graphCredentials?.clear();
        this.graphCredentials = undefined;
        this.client = null;
        void this.outbound?.dispose();
        this.outbound = null;
        this.replyPages.clear();
        this.bufferedReplies.clear();
        this.rootPages.clear();
        this.discoveredRoots.clear();
        this.discoveredRootIds.clear();
        this.historicalReplies.clear();
        this.nextDiscoveredRoot.clear();
        this.notifiedRootIds.clear();
        this.pendingNotificationReconciliations.clear();
        this.notificationRootWatermarks.clear();
        this.pendingNotificationHeads.clear();
        this.nextTrackedRoot = 0;
    }
}
