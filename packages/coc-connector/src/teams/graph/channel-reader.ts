import type { InboundTeamsMessage } from '../types';
import { GraphClient, GraphHttpError, GraphProtocolError, type GraphListResponse } from './graph-client';
import { GraphCredentialStore, type GraphOutboundOptions } from './graph-credential';
import { TeamsOperationError } from '../operations';

/** Graph pages feed the same ID/thread admission scanner as MCP pages. */
export class GraphChannelReader {
    private readonly credentials: GraphCredentialStore;
    private readonly lifetime = new AbortController();

    constructor(account: { tenantId: string; objectId: string } | undefined, options: GraphOutboundOptions = {}) {
        this.credentials = new GraphCredentialStore(account, options, 'read');
    }

    async initialize(): Promise<void> {
        await this.credentials.get(AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]));
    }

    stop(): void {
        this.lifetime.abort();
        this.credentials.clear();
    }

    async page(teamId: string, channelId: string, rootId?: string, nextLink?: string,
        signal?: AbortSignal, top = 50): Promise<{ messages: InboundTeamsMessage[]; nextLink?: string }> {
        const readSignal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
        // Channel reads use the preview API; outbound and standalone clients retain v1.0.
        const client = new GraphClient({
            bearerToken: await this.credentials.get(readSignal), graphBaseUrl: 'https://graph.microsoft.com/beta',
        });
        let page: GraphListResponse;
        try {
            try {
                page = await client.listChannelMessagePage(teamId, channelId, rootId, nextLink, readSignal, top);
            } catch (error) {
                if (!(error instanceof GraphHttpError) || error.status !== 401) throw error;
                client.setBearerToken(await this.credentials.get(readSignal, true));
                page = await client.listChannelMessagePage(teamId, channelId, rootId, nextLink, readSignal, top);
            }
        } catch (error) {
            readSignal.throwIfAborted();
            if (error instanceof GraphHttpError) {
                if (error.status === 401) {
                    throw new GraphHttpError(401, undefined,
                        'Graph channel read authentication rejected (HTTP 401); sign in on the server host with the configured MCP account and reconnect');
                }
                if (error.status === 403) {
                    throw new GraphHttpError(403, undefined,
                        'Graph channel read denied (HTTP 403); verify delegated ChannelMessage.Read.All consent and channel membership for the configured MCP account, then reconnect');
                }
                throw error;
            }
            if (error instanceof TeamsOperationError || error instanceof GraphProtocolError) throw error;
            throw new Error('Graph channel read unavailable; check server connectivity and reconnect');
        }
        readSignal.throwIfAborted();
        return {
            nextLink: page['@odata.nextLink'],
            messages: page.value.map(message => ({
                channelId, messageId: message.id,
                replyToMessageId: rootId,
                text: (message.body?.content ?? '')
                    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
                    .replace(/<[^>]*>/g, '').trim(),
                senderName: message.from?.user?.displayName,
                senderAadId: message.from?.user?.id,
                botAuthored: !!message.from?.application,
                createdDateTime: message.createdDateTime,
            })).sort((a, b) => (Date.parse(a.createdDateTime ?? '') || 0) - (Date.parse(b.createdDateTime ?? '') || 0)),
        };
    }
}
