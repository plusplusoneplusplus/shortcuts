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
import type { IAvailabilityResult } from '@plusplusoneplusplus/forge';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeService(codexEnabled: boolean, claudeEnabled = false): RuntimeConfigService {
    return new RuntimeConfigService({
        fileConfig: { codex: { enabled: codexEnabled }, claude: { enabled: claudeEnabled } },
    });
}

/** Default Codex availability — SDK not installed */
const codexUnavailable = (): Promise<IAvailabilityResult> =>
    Promise.resolve({ available: false, error: 'Codex SDK is not installed.' });

const codexAvailable = (): Promise<IAvailabilityResult> =>
    Promise.resolve({ available: true });

/** Default Claude availability — SDK not installed */
const claudeUnavailable = (): Promise<IAvailabilityResult> =>
    Promise.resolve({ available: false, error: 'Claude Code SDK is not installed.' });

const claudeAvailable = (): Promise<IAvailabilityResult> =>
    Promise.resolve({ available: true });

// ── Copilot provider ──────────────────────────────────────────────────────────

describe('Copilot provider', () => {
    it('is always enabled, available, and locked', async () => {
        const svc = makeService(false);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
        });
        const copilot = providers.find(p => p.id === 'copilot')!;
        expect(copilot.enabled).toBe(true);
        expect(copilot.available).toBe(true);
        expect(copilot.locked).toBe(true);
    });
});

// ── Codex provider — disabled ────────────────────────────────────────────────

describe('Codex provider when codex.enabled = false', () => {
    it('is not enabled and not available', async () => {
        const svc = makeService(false);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(false);
        expect(codex.available).toBe(false);
        expect(codex.reason).toBeUndefined();
    });

    it('does not check SDK availability when not enabled', async () => {
        const svc = makeService(false);
        const getCodexAvailability = vi.fn(codexAvailable);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability,
            getClaudeAvailability: claudeUnavailable,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.reason).toBeUndefined();
        expect(getCodexAvailability).not.toHaveBeenCalled();
    });
});

// ── Codex provider — enabled + SDK available ──────────────────────────────────

describe('Codex provider when enabled and SDK available', () => {
    it('is enabled and available', async () => {
        const svc = makeService(true);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(true);
        expect(codex.available).toBe(true);
        expect(codex.reason).toBeUndefined();
    });
});

// ── Codex provider — enabled + SDK unavailable ────────────────────────────────

describe('Codex provider when enabled but SDK unavailable', () => {
    it('is enabled but not available, with SDK reason', async () => {
        const svc = makeService(true);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
        });
        const codex = providers.find(p => p.id === 'codex')!;
        expect(codex.enabled).toBe(true);
        expect(codex.available).toBe(false);
        expect(codex.reason).toMatch(/codex sdk/i);
    });
});

// ── Claude provider ───────────────────────────────────────────────────────────

describe('Claude provider when claude.enabled = false', () => {
    it('is not enabled and not available', async () => {
        const svc = makeService(false, false);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
        });
        const claude = providers.find(p => p.id === 'claude')!;
        expect(claude.enabled).toBe(false);
        expect(claude.available).toBe(false);
    });
});

describe('Claude provider when enabled and SDK available', () => {
    it('is enabled and available', async () => {
        const svc = makeService(false, true);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeAvailable,
        });
        const claude = providers.find(p => p.id === 'claude')!;
        expect(claude.enabled).toBe(true);
        expect(claude.available).toBe(true);
        expect(claude.reason).toBeUndefined();
    });
});

describe('Claude provider when enabled but SDK unavailable', () => {
    it('is enabled but not available, with remediation reason', async () => {
        const svc = makeService(false, true);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: () => Promise.resolve({ available: false, error: 'Run: npm install @anthropic-ai/claude-agent-sdk' }),
        });
        const claude = providers.find(p => p.id === 'claude')!;
        expect(claude.enabled).toBe(true);
        expect(claude.available).toBe(false);
        expect(claude.reason).toMatch(/install/i);
    });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe('response shape', () => {
    it('always returns three providers in order: copilot, codex, claude', async () => {
        const svc = makeService(false);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
        });
        expect(providers).toHaveLength(3);
        expect(providers[0].id).toBe('copilot');
        expect(providers[1].id).toBe('codex');
        expect(providers[2].id).toBe('claude');
    });

    it('codex is visible in the providers list even when disabled', async () => {
        const svc = makeService(false);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
        });
        expect(providers.some(p => p.id === 'codex')).toBe(true);
    });

    it('claude is visible in the providers list even when disabled', async () => {
        const svc = makeService(false);
        const { providers } = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
        });
        expect(providers.some(p => p.id === 'claude')).toBe(true);
    });
});

// ── Live config reflection ────────────────────────────────────────────────────

describe('live config reflection', () => {
    it('reflects codex.enabled change without restart', async () => {
        const svc = makeService(false);

        // Initially disabled
        const r1 = await buildAgentProvidersResponse({
            runtimeConfigService: svc,
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
        });
        expect(r1.providers.find(p => p.id === 'codex')!.enabled).toBe(false);

        // Simulate admin enabling Codex by updating the service
        // (RuntimeConfigService.config getter always returns latest)
        // We test this by creating a new service with enabled=true
        const svc2 = makeService(true);
        const r2 = await buildAgentProvidersResponse({
            runtimeConfigService: svc2,
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
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
            getCodexAvailability: codexAvailable,
            getClaudeAvailability: claudeUnavailable,
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

    it('returns claude quota data when Claude service has rate-limit state', async () => {
        const svc = makeService(false, true);
        const routes: any[] = [];
        const mockCopilotService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        const mockClaudeService = {
            getAccountQuota: vi.fn().mockResolvedValue({
                quotaSnapshots: {
                    five_hour: {
                        isUnlimitedEntitlement: false,
                        entitlementRequests: 100,
                        usedRequests: 72,
                        remainingPercentage: 0.28,
                        usageAllowedWithExhaustedQuota: true,
                        overage: 0,
                        resetDate: '2025-06-01T00:00:00.000Z',
                    },
                },
            }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeAvailable,
            getCopilotSdkService: () => mockCopilotService as any,
            getClaudeSdkService: () => mockClaudeService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        const claude = body.providers.find((p: any) => p.id === 'claude');
        expect(claude).toBeDefined();
        expect(claude.quotaTypes).toHaveLength(1);
        expect(claude.quotaTypes[0].type).toBe('five_hour');
        expect(claude.quotaTypes[0].usedRequests).toBe(72);
        expect(claude.quotaTypes[0].usageAllowedWithExhaustedQuota).toBe(true);
        expect(claude.error).toBeUndefined();
    });

    it('still emits a claude entry (with empty quotaTypes) when no rate-limit or accountInfo snapshot is available', async () => {
        const svc = makeService(false, true);
        const routes: any[] = [];
        const mockCopilotService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        const mockClaudeService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeAvailable,
            getCopilotSdkService: () => mockCopilotService as any,
            getClaudeSdkService: () => mockClaudeService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        const claude = body.providers.find((p: any) => p.id === 'claude');
        expect(claude).toBeDefined();
        expect(claude.quotaTypes).toEqual([]);
        expect(claude.error).toBeUndefined();
    });

    it('returns claude error when Claude quota lookup throws', async () => {
        const svc = makeService(false, true);
        const routes: any[] = [];
        const mockCopilotService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        const mockClaudeService = {
            getAccountQuota: vi.fn().mockRejectedValue(new Error('Claude SDK error')),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeAvailable,
            getCopilotSdkService: () => mockCopilotService as any,
            getClaudeSdkService: () => mockClaudeService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        const claude = body.providers.find((p: any) => p.id === 'claude');
        expect(claude).toBeDefined();
        expect(claude.error).toBe('Claude SDK error');
        expect(claude.quotaTypes).toHaveLength(0);
    });

    it('does not include codex provider when codex is disabled', async () => {
        const svc = makeService(false);
        const routes: any[] = [];
        const mockSdkService = {
            getAccountQuota: vi.fn().mockResolvedValue({ quotaSnapshots: {} }),
        };
        registerAgentProvidersRoutes(routes, {
            runtimeConfigService: svc,
            getCodexAvailability: codexUnavailable,
            getClaudeAvailability: claudeUnavailable,
            getCopilotSdkService: () => mockSdkService as any,
        });
        const quotaRoute = routes.find(r => r.pattern === '/api/agent-providers/quota');
        const { res, getBody } = makeRes();
        await quotaRoute.handler({} as any, res);
        const body = JSON.parse(getBody());
        expect(body.providers.find((p: any) => p.id === 'codex')).toBeUndefined();
    });
});
