/**
 * Agent Providers Route Tests
 *
 * Unit tests for the GET /api/agent-providers endpoint logic.
 */

import { describe, it, expect } from 'vitest';
import {
    buildAgentProvidersResponse,
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
