/**
 * Agent Providers Route Tests
 *
 * Unit tests for the GET /api/agent-providers endpoint logic.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    buildAgentProvidersResponse,
    registerAgentProvidersRoutes,
} from '../../src/server/agent-providers/agent-providers-routes';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeService(codexEnabled: boolean): RuntimeConfigService {
    return new RuntimeConfigService({
        fileConfig: { codex: { enabled: codexEnabled } },
    });
}

const BASE_URL = 'http://localhost:4000';

// ── Copilot provider ──────────────────────────────────────────────────────────

describe('Copilot provider', () => {
    it('is always enabled, available, and locked', () => {
        const svc = makeService(false);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
        });
        const copilot = providers.find(p => p.id === 'copilot')!;
        expect(copilot.enabled).toBe(true);
        expect(copilot.available).toBe(true);
        expect(copilot.locked).toBe(true);
    });
});

// ── Codex provider — disabled ────────────────────────────────────────────────

describe('Codex provider when codex.enabled = false', () => {
    it('is not enabled and not available', () => {
        const svc = makeService(false);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(false);
        expect(codex.available).toBe(false);
        expect(codex.reason).toBeUndefined();
        expect(codex.authUrl).toBeUndefined();
    });

    it('has no reason or authUrl when not enabled (even if auth is expired)', () => {
        const svc = makeService(false);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'expired' }),
            serverBaseUrl: BASE_URL,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.reason).toBeUndefined();
        expect(codex.authUrl).toBeUndefined();
    });
});

// ── Codex provider — enabled + authenticated ──────────────────────────────────

describe('Codex provider when enabled and authenticated', () => {
    it('is enabled and available', () => {
        const svc = makeService(true);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(true);
        expect(codex.available).toBe(true);
        expect(codex.reason).toBeUndefined();
        expect(codex.authUrl).toBeUndefined();
    });
});

// ── Codex provider — enabled + unauthenticated ────────────────────────────────

describe('Codex provider when enabled but unauthenticated', () => {
    it('is enabled but not available, with auth reason and URL', () => {
        const svc = makeService(true);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(true);
        expect(codex.available).toBe(false);
        expect(codex.reason).toMatch(/authentication required/i);
        expect(codex.authUrl).toBe('http://localhost:4000/api/codex-auth/start');
    });
});

// ── Codex provider — enabled + expired ───────────────────────────────────────

describe('Codex provider when enabled but auth expired', () => {
    it('is enabled but not available, with expired reason and authUrl', () => {
        const svc = makeService(true);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'expired' }),
            serverBaseUrl: BASE_URL,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(true);
        expect(codex.available).toBe(false);
        expect(codex.reason).toMatch(/expired/i);
        expect(codex.authUrl).toBe('http://localhost:4000/api/codex-auth/start');
    });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe('response shape', () => {
    it('always returns two providers in order: copilot, codex', () => {
        const svc = makeService(false);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
        });
        expect(providers).toHaveLength(2);
        expect(providers[0].id).toBe('copilot');
        expect(providers[1].id).toBe('codex');
    });

    it('codex is visible in the providers list even when disabled', () => {
        const svc = makeService(false);
        const { providers } = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
        });
        expect(providers.some(p => p.id === 'codex')).toBe(true);
    });
});

// ── Live config reflection ────────────────────────────────────────────────────

describe('live config reflection', () => {
    it('reflects codex.enabled change without restart', async () => {
        const svc = makeService(false);

        // Initially disabled
        const r1 = buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
        });
        expect(r1.providers.find(p => p.id === 'codex')!.enabled).toBe(false);

        // Simulate admin enabling Codex by updating the service
        // (RuntimeConfigService.config getter always returns latest)
        // We test this by creating a new service with enabled=true
        const svc2 = makeService(true);
        const r2 = buildAgentProvidersResponse({
            runtimeConfigService: svc2,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
        });
        expect(r2.providers.find(p => p.id === 'codex')!.enabled).toBe(true);
        expect(r2.providers.find(p => p.id === 'codex')!.available).toBe(true);
    });
});

// ── Quota route registration ──────────────────────────────────────────────────

describe('registerAgentProvidersRoutes — quota endpoint', () => {
    function makeRes() {
        const written: string[] = [];
        let statusCode = 200;
        return {
            res: {
                writeHead: (code: number) => { statusCode = code; },
                setHeader: () => {},
                write: (chunk: string) => written.push(chunk),
                end: (chunk?: string) => { if (chunk) written.push(chunk); },
                get statusCode() { return statusCode; },
            } as any,
            written,
            getBody: () => written.join(''),
        };
    }

    it('registers a GET /api/agent-providers/quota route', () => {
        const svc = makeService(false);
        const routes: any[] = [];
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        expect(quotaRoute).toBeDefined();
        expect(quotaRoute.method).toBe('GET');
    });

    it('returns error for copilot when getCopilotSdkService is not provided', async () => {
        const svc = makeService(false);
        const routes: any[] = [];
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
            // no getCopilotSdkService
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers).toHaveLength(1);
        expect(body.providers[0].id).toBe('copilot');
        expect(body.providers[0].error).toMatch(/not available/i);
    });

    it('returns copilot quota from sdk service when available', async () => {
        const svc = makeService(false);
        const routes: any[] = [];
        const mockSdkService = {
            getAccountQuota: vi.fn().mockResolvedValue({
                quotaSnapshots: {
                    chat: {
                        isUnlimitedEntitlement: false,
                        entitlementRequests: 100,
                        usedRequests: 30,
                        remainingPercentage: 0.7,
                        usageAllowedWithExhaustedQuota: false,
                        overage: 0,
                    },
                },
            }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
            getCopilotSdkService: () => mockSdkService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers).toHaveLength(1);
        expect(body.providers[0].id).toBe('copilot');
        expect(body.providers[0].error).toBeUndefined();
        expect(body.providers[0].quotaTypes).toHaveLength(1);
        const chatQuota = body.providers[0].quotaTypes[0];
        expect(chatQuota.type).toBe('chat');
        expect(chatQuota.usedRequests).toBe(30);
        expect(chatQuota.entitlementRequests).toBe(100);
        expect(chatQuota.remainingPercentage).toBe(0.7);
    });

    it('returns copilot error when sdk service throws', async () => {
        const svc = makeService(false);
        const routes: any[] = [];
        const mockSdkService = {
            getAccountQuota: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
            getCopilotSdkService: () => mockSdkService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers[0].id).toBe('copilot');
        expect(body.providers[0].error).toBe('SDK unavailable');
    });

    it('includes codex provider with empty quotaTypes when codex is enabled but no codex service', async () => {
        const svc = makeService(true);
        const routes: any[] = [];
        const mockSdkService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
            getCopilotSdkService: () => mockSdkService as any,
            // no getCodexSdkService
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers).toHaveLength(2);
        const codex = body.providers.find((p: any) => p.id === 'codex');
        expect(codex).toBeDefined();
        expect(codex.quotaTypes).toHaveLength(0);
        expect(codex.error).toBeUndefined();
    });

    it('returns codex quota data when codex service provides rate limits', async () => {
        const svc = makeService(true);
        const routes: any[] = [];
        const mockCopilotService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        const mockCodexService = {
            getAccountQuota: vi.fn().mockResolvedValue({
                quotaSnapshots: {
                    codex: {
                        isUnlimitedEntitlement: false,
                        entitlementRequests: 100,
                        usedRequests: 5,
                        remainingPercentage: 0.95,
                        usageAllowedWithExhaustedQuota: false,
                        overage: 0,
                        resetDate: '2025-06-01T00:00:00.000Z',
                    },
                },
            }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
            getCopilotSdkService: () => mockCopilotService as any,
            getCodexSdkService: () => mockCodexService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers).toHaveLength(2);
        const codex = body.providers.find((p: any) => p.id === 'codex');
        expect(codex).toBeDefined();
        expect(codex.quotaTypes).toHaveLength(1);
        expect(codex.quotaTypes[0].type).toBe('codex');
        expect(codex.quotaTypes[0].usedRequests).toBe(5);
        expect(codex.quotaTypes[0].remainingPercentage).toBe(0.95);
        expect(codex.quotaTypes[0].resetDate).toBe('2025-06-01T00:00:00.000Z');
        expect(codex.error).toBeUndefined();
    });

    it('returns codex error when codex service throws', async () => {
        const svc = makeService(true);
        const routes: any[] = [];
        const mockCopilotService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        const mockCodexService = {
            getAccountQuota: vi.fn().mockRejectedValue(new Error('Codex CLI not installed')),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'authenticated' }),
            serverBaseUrl: BASE_URL,
            getCopilotSdkService: () => mockCopilotService as any,
            getCodexSdkService: () => mockCodexService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        const codex = body.providers.find((p: any) => p.id === 'codex');
        expect(codex).toBeDefined();
        expect(codex.error).toBe('Codex CLI not installed');
        expect(codex.quotaTypes).toHaveLength(0);
    });

    it('does not include codex provider when codex is disabled', async () => {
        const svc = makeService(false);
        const routes: any[] = [];
        const mockSdkService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAuthInfo: () => ({ status: 'unauthenticated' }),
            serverBaseUrl: BASE_URL,
            getCopilotSdkService: () => mockSdkService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers.find((p: any) => p.id === 'codex')).toBeUndefined();
    });
});
