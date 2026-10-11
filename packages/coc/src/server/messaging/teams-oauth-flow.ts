import { randomUUID } from 'node:crypto';
import { AuthError } from '@plusplusoneplusplus/coc-native';
import type { TeamsOAuthCredential } from '@plusplusoneplusplus/coc-connector/teams';
import type { McpOauthManager } from '../mcp-oauth/mcp-oauth-manager';

type SignInCredential = Pick<TeamsOAuthCredential, 'beginBrowser' | 'wait' | 'cancelSignIn'>;

export class TeamsOAuthFlow {
    private active: { credential: SignInCredential; requestId: string } | null = null;
    private generation = 0;

    constructor(
        private readonly pending: McpOauthManager,
        private readonly credential: (serverUrl: string) => SignInCredential,
    ) {}

    async start(serverUrl: string, context?: { workspaceId?: string; processId?: string }): Promise<{
        requestId: string; authorizationUrl: string;
    }> {
        if (this.active) throw new Error('Microsoft Teams authorization is already in progress');
        const credential = this.credential(serverUrl);
        const requestId = randomUUID();
        const generation = this.generation;
        const active = { credential, requestId };
        this.active = active;
        try {
            const instructions = await credential.beginBrowser();
            if (generation !== this.generation) throw new Error('Microsoft Teams authorization was interrupted');
            this.pending.addPending({
                requestId, serverName: 'Microsoft Teams', serverUrl,
                authorizationUrl: instructions.authorizationUrl, ...context,
            });
            void credential.wait().then(() => {
                if (this.active !== active) return;
                if (this.pending.getPending(requestId)?.status === 'pending') {
                    this.pending.resolve(requestId, 'completed');
                }
            }).catch(error => {
                if (this.active !== active) return;
                const reason = error instanceof AuthError ? error.code : 'Teams authentication failed';
                this.pending.resolve(requestId, 'failed', reason);
            }).finally(() => {
                if (this.active === active) this.active = null;
            });
            return { requestId, authorizationUrl: instructions.authorizationUrl };
        } catch (error) {
            if (this.active === active) {
                this.active = null;
                credential.cancelSignIn();
            }
            throw error;
        }
    }

    cancel(requestId?: string): void {
        if (requestId && this.active?.requestId !== requestId) return;
        this.generation++;
        const active = this.active;
        this.active = null;
        if (!active) return;
        active.credential.cancelSignIn();
        this.pending.resolve(active.requestId, 'failed', 'Microsoft sign-in was interrupted');
    }

    isPending(requestId: string): boolean { return this.active?.requestId === requestId; }
}
