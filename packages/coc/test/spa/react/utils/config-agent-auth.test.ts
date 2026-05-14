/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'coc-authenticated-agents';

// Mock openRelayIfNeeded to avoid side effects
vi.mock('../../../../src/server/spa/client/react/utils/agent-relay', () => ({
    openRelayIfNeeded: vi.fn(),
}));

// We need to re-import fresh for each test to pick up localStorage state
async function loadModule() {
    // Clear module cache so the module re-reads localStorage on import
    const modulePath = '../../../../src/server/spa/client/react/utils/config';
    vi.resetModules();
    return import(modulePath);
}

describe('authenticated agent cache (localStorage persistence)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('markAgentAuthenticated persists to localStorage', async () => {
        const { markAgentAuthenticated } = await loadModule();
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');

        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(stored).toEqual([['agent-1', 'https://tunnel1.devtunnels.ms']]);
    });

    it('isAgentAuthenticated returns true after marking', async () => {
        const { markAgentAuthenticated, isAgentAuthenticated } = await loadModule();
        expect(isAgentAuthenticated('agent-1')).toBe(false);
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');
        expect(isAgentAuthenticated('agent-1')).toBe(true);
    });

    it('getAuthenticatedAgentAddress returns address after marking', async () => {
        const { markAgentAuthenticated, getAuthenticatedAgentAddress } = await loadModule();
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');
        expect(getAuthenticatedAgentAddress('agent-1')).toBe('https://tunnel1.devtunnels.ms');
    });

    it('persisted auth survives module reload (simulates page refresh)', async () => {
        const mod1 = await loadModule();
        mod1.markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');

        // Reload module — simulates page refresh
        const mod2 = await loadModule();
        expect(mod2.isAgentAuthenticated('agent-1')).toBe(true);
        expect(mod2.getAuthenticatedAgentAddress('agent-1')).toBe('https://tunnel1.devtunnels.ms');
    });

    it('clearAgentAuth removes a single agent', async () => {
        const { markAgentAuthenticated, clearAgentAuth, isAgentAuthenticated } = await loadModule();
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');
        markAgentAuthenticated('agent-2', 'https://tunnel2.devtunnels.ms');

        clearAgentAuth('agent-1');
        expect(isAgentAuthenticated('agent-1')).toBe(false);
        expect(isAgentAuthenticated('agent-2')).toBe(true);

        // Verify persistence
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(stored).toEqual([['agent-2', 'https://tunnel2.devtunnels.ms']]);
    });

    it('clearAllAgentAuth removes all agents', async () => {
        const { markAgentAuthenticated, clearAllAgentAuth, isAgentAuthenticated } = await loadModule();
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');
        markAgentAuthenticated('agent-2', 'https://tunnel2.devtunnels.ms');

        clearAllAgentAuth();
        expect(isAgentAuthenticated('agent-1')).toBe(false);
        expect(isAgentAuthenticated('agent-2')).toBe(false);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
    });

    it('handles corrupt localStorage gracefully', async () => {
        localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
        const { isAgentAuthenticated, markAgentAuthenticated } = await loadModule();

        // Should start with empty map (graceful recovery)
        expect(isAgentAuthenticated('agent-1')).toBe(false);

        // Should still work after recovery
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');
        expect(isAgentAuthenticated('agent-1')).toBe(true);
    });

    it('handles non-array localStorage value gracefully', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        const { isAgentAuthenticated } = await loadModule();
        expect(isAgentAuthenticated('agent-1')).toBe(false);
    });

    it('multiple agents persist correctly', async () => {
        const { markAgentAuthenticated, getAuthenticatedAgentAddress } = await loadModule();
        markAgentAuthenticated('agent-1', 'https://tunnel1.devtunnels.ms');
        markAgentAuthenticated('agent-2', 'https://tunnel2.devtunnels.ms');
        markAgentAuthenticated('agent-3', 'https://tunnel3.devtunnels.ms');

        // Reload
        const mod2 = await loadModule();
        expect(mod2.getAuthenticatedAgentAddress('agent-1')).toBe('https://tunnel1.devtunnels.ms');
        expect(mod2.getAuthenticatedAgentAddress('agent-2')).toBe('https://tunnel2.devtunnels.ms');
        expect(mod2.getAuthenticatedAgentAddress('agent-3')).toBe('https://tunnel3.devtunnels.ms');
    });
});
