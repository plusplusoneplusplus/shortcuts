import { TeamsAzureCliCredential } from '../azure-cli-credential';
import { AuthError, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { TeamsOperationError } from '../operations';

export interface GraphOutboundOptions {
    acquireToken?: (signal: AbortSignal) => Promise<string>;
}

/** Delegated channel credentials are separately scoped and pinned to the MCP account. */
export class GraphCredentialStore {
    private token?: string;
    private expiresAt = 0;
    private readonly acquireToken: NonNullable<GraphOutboundOptions['acquireToken']>;
    private readonly nativeCredential?: TeamsAzureCliCredential;

    constructor(
        private readonly account: { tenantId: string; objectId: string } | undefined,
        options: GraphOutboundOptions = {},
        private readonly purpose: 'read' | 'write' = 'write',
    ) {
        if (!options.acquireToken) this.nativeCredential = new TeamsAzureCliCredential('https://graph.microsoft.com');
        this.acquireToken = options.acquireToken ?? (signal => this.nativeCredential!.get(signal));
    }

    clear(): void {
        this.nativeCredential?.clear();
        this.token = undefined;
        this.expiresAt = 0;
    }

    dispose(): void {
        this.nativeCredential?.dispose();
        this.clear();
    }

    async get(signal: AbortSignal, refresh = false): Promise<string> {
        signal.throwIfAborted();
        if (!this.account) throw this.invalid(`Graph ${this.purpose === 'read' ? 'reader' : 'outbound'} requires an MCP reader tenant/object identity`);
        if (!this.nativeCredential && !refresh && this.token && this.expiresAt > Date.now() + 60_000) return this.token;
        this.token = undefined;
        this.expiresAt = 0;
        let token: string;
        let onAbort = () => {};
        try {
            token = await new Promise<string>((resolve, reject) => {
                onAbort = () => reject(this.invalid('Graph credential acquisition cancelled or timed out'));
                signal.addEventListener('abort', onAbort, { once: true });
                (this.nativeCredential ? this.nativeCredential.get(signal, refresh) : this.acquireToken(signal)).then(resolve, reject);
            });
        } catch (error) {
            if (signal.aborted) throw this.invalid('Graph credential acquisition cancelled or timed out');
            if (error instanceof NativeAddonLoadError) {
                throw new TeamsOperationError('Graph native authentication unavailable; rebuild with npm run build:native -w packages/coc-native',
                    'graph', 'unavailable', 'not-attempted');
            }
            const reason = error instanceof AuthError ? ` (${error.code})` : '';
            throw this.invalid(`Graph credential unavailable${reason}; install Azure CLI if needed and run az login on the server host with the MCP reader account, then reconnect`);
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
        if (!this.nativeCredential) {
            this.expiresAt = claims.exp * 1000;
            this.token = token;
        }
        return token;
    }

    private invalid(message: string): TeamsOperationError {
        return new TeamsOperationError(message, 'graph', 'authentication', 'not-attempted');
    }
}
