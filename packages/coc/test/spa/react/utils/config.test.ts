import { describe, it, expect, afterEach } from 'vitest';
import {
    getConfiguredDefaultProvider,
    getDefaultProvider,
    isAutoAgentProviderRoutingEnabled,
    isCommitChatLensEnabled,
    isServersEnabled,
} from '../../../../src/server/spa/client/react/utils/config';

afterEach(() => {
    delete (window as any).__DASHBOARD_CONFIG__;
});

describe('isServersEnabled', () => {
    it('returns false when __DASHBOARD_CONFIG__ is undefined', () => {
        expect(isServersEnabled()).toBe(false);
    });

    it('returns false when serversEnabled is omitted from config', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isServersEnabled()).toBe(false);
    });

    it('returns false when serversEnabled is explicitly false', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', serversEnabled: false };
        expect(isServersEnabled()).toBe(false);
    });

    it('returns true when serversEnabled is explicitly true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', serversEnabled: true };
        expect(isServersEnabled()).toBe(true);
    });

    it('returns false for truthy non-boolean values (strict equality)', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', serversEnabled: 1 as unknown as boolean };
        expect(isServersEnabled()).toBe(false);
    });
});

describe('isCommitChatLensEnabled', () => {
    it('returns false when commitChatLensEnabled is omitted from config', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isCommitChatLensEnabled()).toBe(false);
    });

    it('returns true when commitChatLensEnabled is explicitly true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', commitChatLensEnabled: true };
        expect(isCommitChatLensEnabled()).toBe(true);
    });
});

describe('default provider helpers', () => {
    it('returns copilot as the default configured provider when omitted', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(getConfiguredDefaultProvider()).toBe('copilot');
        expect(getDefaultProvider()).toBe('copilot');
    });

    it('returns concrete configured providers unchanged', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', defaultProvider: 'claude' };
        expect(getConfiguredDefaultProvider()).toBe('claude');
        expect(getDefaultProvider()).toBe('claude');
    });

    it('exposes auto as the configured provider but falls back to copilot for concrete provider callers', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            defaultProvider: 'auto',
            autoAgentProviderRoutingEnabled: true,
        };
        expect(getConfiguredDefaultProvider()).toBe('auto');
        expect(getDefaultProvider()).toBe('copilot');
        expect(isAutoAgentProviderRoutingEnabled()).toBe(true);
    });
});
