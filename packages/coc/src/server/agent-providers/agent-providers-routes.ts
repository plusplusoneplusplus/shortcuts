/**
 * Agent Providers REST API Routes
 *
 * GET /api/agent-providers
 *   Returns enabled/available status for Copilot and Codex so the
 *   New Chat UI and Admin page can show live provider state without a
 *   server restart.
 *
 * Copilot is always enabled, available, and locked.
 * Codex status is derived from:
 *   - `codex.enabled` in live runtime config (enabled flag)
 *   - Codex auth store (available flag; requires authenticated status)
 */

import type { Route } from '../types';
import { sendJson } from '../shared/router';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { CodexAuthInfo } from '../codex-auth/codex-auth-store';
import type { AgentProviderStatus, AgentProvidersResponse } from '@plusplusoneplusplus/coc-client';

export interface AgentProvidersRouteContext {
    runtimeConfigService: RuntimeConfigService;
    /** Reads current Codex auth info. Returns unauthenticated info if Codex infra is absent. */
    getCodexAuthInfo: () => CodexAuthInfo;
    /** The base URL prefix used to build authUrl (e.g. 'http://localhost:4000'). */
    serverBaseUrl: string;
}

/** Build the providers array from live config + auth state. Exported for unit testing. */
export function buildAgentProvidersResponse(ctx: AgentProvidersRouteContext): AgentProvidersResponse {
    const config = ctx.runtimeConfigService.config;
    const codexEnabled = config.codex?.enabled ?? false;

    const copilot: AgentProviderStatus = {
        id: 'copilot',
        label: 'Copilot',
        enabled: true,
        available: true,
        locked: true,
    };

    let codexProvider: AgentProviderStatus;
    if (!codexEnabled) {
        codexProvider = {
            id: 'codex',
            label: 'Codex',
            enabled: false,
            available: false,
        };
    } else {
        const authInfo: CodexAuthInfo = ctx.getCodexAuthInfo();
        const authenticated = authInfo.status === 'authenticated';
        if (authenticated) {
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: true,
            };
        } else {
            const reason = authInfo.status === 'expired'
                ? 'Codex authentication has expired.'
                : 'Codex authentication required.';
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: false,
                reason,
                authUrl: `${ctx.serverBaseUrl}/api/codex-auth/start`,
            };
        }
    }

    return { providers: [copilot, codexProvider] };
}

export function registerAgentProvidersRoutes(routes: Route[], ctx: AgentProvidersRouteContext): void {
    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers',
        handler: (_req, res) => {
            const body = buildAgentProvidersResponse(ctx);
            sendJson(res, body);
        },
    });
}
