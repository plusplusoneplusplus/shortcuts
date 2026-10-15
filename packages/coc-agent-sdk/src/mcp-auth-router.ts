import type { CopilotSession, SessionConfig } from '@github/copilot-sdk';
import type { McpOAuthEvent } from './types';

type AuthHandler = NonNullable<SessionConfig['onMcpAuthRequest']>;

/** Per-invocation routing; unmanaged credentials stay entirely inside the runtime. */
export class McpAuthRouter {
    private sessionReady: Promise<CopilotSession | null>;
    private resolveSession!: (session: CopilotSession | null) => void;
    private closed = false;
    private logins = new Map<string, Promise<void>>();
    private managedServers: Record<string, string>;
    private deadlineTimer: ReturnType<typeof setTimeout>;
    private readonly abort = () => this.close();

    constructor(
        managedServers: Record<string, string>,
        private readonly handler: AuthHandler,
        private readonly notify: ((event: McpOAuthEvent) => void) | undefined,
        private readonly signal: AbortSignal | undefined,
        private readonly deadline: number,
    ) {
        this.managedServers = { ...managedServers };
        this.sessionReady = new Promise(resolve => { this.resolveSession = resolve; });
        this.deadlineTimer = setTimeout(() => this.close(), Math.max(0, deadline - Date.now()));
        this.deadlineTimer.unref?.();
        signal?.addEventListener('abort', this.abort, { once: true });
        if (signal?.aborted) this.close();
    }

    ready(session: CopilotSession): void {
        this.resolveSession(session);
    }

    close(): void {
        this.closed = true;
        clearTimeout(this.deadlineTimer);
        this.signal?.removeEventListener('abort', this.abort);
        this.resolveSession(null);
        this.logins.clear();
    }

    private get active(): boolean {
        return !this.closed && !this.signal?.aborted && Date.now() < this.deadline;
    }

    owns(serverName: string, serverUrl: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.managedServers, serverName)
            || Object.values(this.managedServers).includes(serverUrl);
    }

    readonly onAuthRequest: AuthHandler = (request, context) => {
        if (!this.active) return { kind: 'cancelled' };
        if (this.owns(request.serverName, request.serverUrl)) {
            return Object.prototype.hasOwnProperty.call(this.managedServers, request.serverName)
                && this.managedServers[request.serverName] === request.serverUrl
                ? Promise.resolve(this.handler(request, context)).then(result => this.active ? result : { kind: 'cancelled' as const })
                : { kind: 'cancelled' };
        }
        // Do not await readiness from the SDK handler: create/resume can still be
        // waiting on the event-interest RPC that delivered this request.
        this.login(request.serverName, request.serverUrl, request.requestId, context.sessionId);
        return { kind: 'cancelled' };
    };

    login(serverName: string, serverUrl: string, requestId?: string, expectedSessionId?: string): void {
        if (!this.active || !this.notify || this.owns(serverName, serverUrl) || this.logins.has(serverName)) return;
        const task = (async () => {
            const session = await this.sessionReady;
            if (!session || !this.active || (expectedSessionId && session.sessionId !== expectedSessionId)) return;
            try {
                if (requestId) {
                    // Await acknowledgement before reconnecting. The SDK may
                    // already have cancelled it; a second acknowledgement is safe.
                    await session.rpc.mcp.oauth.handlePendingRequest({ requestId, result: { kind: 'cancelled' } });
                    if (!this.active) return;
                }
                const result = await session.rpc.mcp.oauth.login({ serverName });
                if (!this.active || (!requestId && !result.authorizationUrl)) return;
                this.dispatch({
                    serverName, serverUrl, requestId: requestId ?? `proactive-${serverName}`,
                    authorizationUrl: result.authorizationUrl, sessionId: session.sessionId,
                });
            } catch {
                if (!this.active || !requestId) return;
                this.dispatch({ serverName, serverUrl, requestId, sessionId: session.sessionId });
            }
        })().finally(() => { this.logins.delete(serverName); });
        this.logins.set(serverName, task);
    }

    private dispatch(event: McpOAuthEvent): void {
        try { this.notify?.(event); } catch { /* notifications cannot fail authentication routing */ }
    }
}
