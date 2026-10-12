import type { ResolvedContainerConfig, ResolvedTeamsConfig } from '../config';
import type { ContainerRuntime } from './runtime';
import type { MessagingConfigService } from './messaging-config';
import { AuthError } from '@plusplusoneplusplus/coc-native';

export interface TeamsAuthControllerDeps {
    config: ResolvedContainerConfig;
    runtime: ContainerRuntime;
    messagingConfig: MessagingConfigService;
}

/** Browser sign-in is server-owned; the UI receives only instructions and status. */
export class TeamsAuthController {
    private generation = 0;
    private pending = false;
    private error?: string;
    private demandError?: string;

    constructor(private readonly deps: TeamsAuthControllerDeps) {}

    async start(): Promise<Record<string, unknown>> {
        const { config, runtime, messagingConfig } = this.deps;
        const teams = config.messaging?.teams;
        if (!teams?.mcpServerUrl) return { ok: false, error: 'No mcpServerUrl configured' };
        const generation = ++this.generation;
        this.error = undefined;
        this.demandError = undefined;
        try {
            const credential = runtime.getTeamsCredential(teams);
            const instructions = await credential.beginBrowser();
            if (generation !== this.generation) return { ok: false, error: 'Sign-in cancelled' };
            this.pending = true;
            void credential.wait().then(async () => {
                if (generation !== this.generation || runtime.getTeamsCredential(teams) !== credential) return;
                if (runtime.teamsBridge) {
                    await runtime.teamsBridge.reconnect();
                } else {
                    messagingConfig.enableTeams(teams.mcpServerUrl);
                    const resolved = { ...teams, enabled: true } as ResolvedTeamsConfig;
                    await runtime.startTeamsBridge(resolved);
                }
            }).catch(() => {
                if (generation === this.generation) this.error = 'Teams sign-in or connection failed';
            }).finally(() => {
                if (generation === this.generation) this.pending = false;
            });
            return { ok: true, ...instructions, status: 'pending' };
        } catch {
            this.pending = false;
            this.error = 'Unable to start Teams sign-in';
            return { ok: false, error: this.error };
        }
    }

    async status(): Promise<Record<string, unknown>> {
        try {
            const credential = this.deps.runtime.getTeamsCredential();
            if (!this.pending) {
                await credential.getToken();
                this.demandError = undefined;
            }
            const error = this.error ?? this.demandError;
            return { authenticated: !this.pending && !error && credential.getStatus() === 'authenticated',
                status: error ? 'error' : this.pending ? 'pending' : credential.getStatus(),
                ...(error ? { error } : {}) };
        } catch (error) {
            const code = error instanceof AuthError ? error.code : 'AuthenticationFailed';
            const loginRequired = code === 'LoginRequired' || code === 'InteractionRequired';
            const reason = loginRequired
                ? 'Teams sign-in required. Sign in again to continue.'
                : `Teams authentication failed: ${code}. Check authentication configuration and retry.`;
            if (!loginRequired) {
                if (this.demandError !== reason) console.warn(`[container] Teams auth status: ${code}`);
                this.demandError = reason;
            } else if (!this.pending) {
                this.demandError = undefined;
            }
            const failure = this.error ?? this.demandError;
            return { authenticated: false, status: failure ? 'error' : 'unauthenticated',
                error: failure ?? reason };
        }
    }

    async cancel(): Promise<Record<string, unknown>> {
        ++this.generation;
        this.pending = false;
        this.error = undefined;
        this.demandError = undefined;
        try {
            this.deps.runtime.getTeamsCredential().cancelSignIn();
            return { ok: true };
        } catch { return { ok: false, error: 'Unable to cancel Teams sign-in' }; }
    }

    async logout(): Promise<Record<string, unknown>> {
        ++this.generation;
        this.pending = false;
        this.error = undefined;
        this.demandError = undefined;
        const { runtime } = this.deps;
        try {
            const credential = runtime.getTeamsCredential();
            credential.cancelSignIn();
            await runtime.teamsBridge?.stop();
            runtime.teamsBridge = undefined;
            await credential.deleteCredentials();
            return { ok: true, message: 'Logged out and credentials deleted' };
        } catch {
            this.error = 'Unable to stop Teams or delete credentials';
            return { ok: false, error: this.error };
        }
    }
}
