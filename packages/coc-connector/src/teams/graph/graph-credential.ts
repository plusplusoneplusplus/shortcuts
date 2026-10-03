import { acquireTokenViaAzCli } from '../auth';
import { TeamsOperationError } from '../operations';

export interface GraphOutboundOptions {
    acquireToken?: (signal: AbortSignal) => Promise<string>;
}

/** Delegated channel credentials are separately scoped and pinned to the MCP account. */
export class GraphCredentialStore {
    private token?: string;
    private expiresAt = 0;
    private readonly acquireToken: NonNullable<GraphOutboundOptions['acquireToken']>;

    constructor(
        private readonly account: { tenantId: string; objectId: string } | undefined,
        options: GraphOutboundOptions = {},
        private readonly purpose: 'read' | 'write' = 'write',
    ) {
        this.acquireToken = options.acquireToken ?? (signal => acquireTokenViaAzCli('https://graph.microsoft.com', signal));
    }

    clear(): void {
        this.token = undefined;
        this.expiresAt = 0;
    }

    async get(signal: AbortSignal, refresh = false): Promise<string> {
        signal.throwIfAborted();
        if (!this.account) throw this.invalid(`Graph ${this.purpose === 'read' ? 'reader' : 'outbound'} requires an MCP reader tenant/object identity`);
        if (!refresh && this.token && this.expiresAt > Date.now() + 60_000) return this.token;
        this.clear();
        let token: string;
        let onAbort = () => {};
        try {
            token = await new Promise<string>((resolve, reject) => {
                onAbort = () => reject(this.invalid('Graph credential acquisition cancelled or timed out'));
                signal.addEventListener('abort', onAbort, { once: true });
                this.acquireToken(signal).then(resolve, reject);
            });
        } catch {
            if (signal.aborted) throw this.invalid('Graph credential acquisition cancelled or timed out');
            throw this.invalid('Graph credential unavailable; install Azure CLI if needed and run az login on the server host with the MCP reader account, then reconnect');
        } finally {
            signal.removeEventListener('abort', onAbort);
        }
        signal.throwIfAborted();
        let claims: { aud?: unknown; tid?: unknown; oid?: unknown; scp?: unknown; exp?: unknown };
        try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
        catch { throw this.invalid('Invalid Graph credential'); }
        if (!claims || !['https://graph.microsoft.com', 'https://graph.microsoft.com/', '00000003-0000-0000-c000-000000000000'].includes(String(claims.aud))
            || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() + 60_000) {
            throw this.invalid('Invalid Graph credential audience or expiry');
        }
        if (typeof claims.tid !== 'string' || typeof claims.oid !== 'string'
            || claims.tid.toLowerCase() !== this.account.tenantId.toLowerCase()
            || claims.oid.toLowerCase() !== this.account.objectId.toLowerCase()) {
            throw this.invalid('Graph account identity mismatch; sign in with the MCP reader account and reconnect');
        }
        const scopes = typeof claims.scp === 'string' ? claims.scp.split(/\s+/) : [];
        if (this.purpose === 'read' && !scopes.some(scope =>
            ['ChannelMessage.Read.All', 'Group.Read.All', 'Group.ReadWrite.All'].includes(scope))) {
            throw this.invalid('Graph channel reads require delegated ChannelMessage.Read.All consent, separately from ChannelMessage.Send. Request least-privilege ChannelMessage.Read.All for the Graph client, sign in on the server host with the MCP account, then reconnect; Azure CLI sign-in alone does not grant consent');
        }
        // Graph documents Group.ReadWrite.All compatibility for both channel posts and replies.
        if (this.purpose === 'write' && !scopes.includes('ChannelMessage.Send') && !scopes.includes('Group.ReadWrite.All')) {
            throw this.invalid('Graph outbound requires delegated ChannelMessage.Send or an existing Group.ReadWrite.All grant. Request least-privilege ChannelMessage.Send consent for new Entra public clients; backend selection or Azure CLI sign-in alone does not grant consent');
        }
        this.expiresAt = claims.exp * 1000;
        this.token = token;
        return token;
    }

    private invalid(message: string): TeamsOperationError {
        return new TeamsOperationError(message, 'graph', 'authentication', 'not-attempted');
    }
}
