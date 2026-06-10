import { describe, it, expect, afterEach } from 'vitest';
import {
    DASHBOARD_CONFIG_UPDATED_EVENT,
    _resetRuntimeConfig,
    applyRuntimeConfigPatch,
    getConfiguredDefaultProvider,
    getDefaultProvider,
    getCommitChatLensDormantMode,
    isAutoAgentProviderRoutingEnabled,
    isCommitChatLensEnabled,
    isDreamsEnabled,
    isPullRequestsAutoClassifyTeamEnabled,
    isServersEnabled,
} from '../../../../src/server/spa/client/react/utils/config';

afterEach(() => {
    _resetRuntimeConfig();
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

    it('applies runtime patches and emits a config-updated event', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', commitChatLensEnabled: false };
        let eventDetail: unknown;
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, (event) => {
            eventDetail = (event as CustomEvent).detail;
        }, { once: true });

        applyRuntimeConfigPatch({ commitChatLensEnabled: true });

        expect(isCommitChatLensEnabled()).toBe(true);
        expect(eventDetail).toMatchObject({
            patch: { commitChatLensEnabled: true },
        });
    });
});

describe('isDreamsEnabled', () => {
    it('returns false when dreamsEnabled is omitted from config', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isDreamsEnabled()).toBe(false);
    });

    it('returns true when dreamsEnabled is explicitly true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', dreamsEnabled: true };
        expect(isDreamsEnabled()).toBe(true);
    });
});

describe('isPullRequestsAutoClassifyTeamEnabled', () => {
    it('returns false when omitted from config', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isPullRequestsAutoClassifyTeamEnabled()).toBe(false);
    });

    it('returns true when explicitly true', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            pullRequestsAutoClassifyTeamEnabled: true,
        };
        expect(isPullRequestsAutoClassifyTeamEnabled()).toBe(true);
    });
});

describe('getCommitChatLensDormantMode', () => {
    it('returns ghost when commitChatLensDormantMode is omitted', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(getCommitChatLensDormantMode()).toBe('ghost');
    });

    it('returns ghost when commitChatLensDormantMode is explicitly ghost', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', commitChatLensDormantMode: 'ghost' };
        expect(getCommitChatLensDormantMode()).toBe('ghost');
    });

    it('returns pill when commitChatLensDormantMode is explicitly pill', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', commitChatLensDormantMode: 'pill' };
        expect(getCommitChatLensDormantMode()).toBe('pill');
    });

    it('returns ghost for unknown values', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', commitChatLensDormantMode: 'unknown' };
        expect(getCommitChatLensDormantMode()).toBe('ghost');
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

    it('keeps the configured provider concrete when Auto routing is enabled', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            autoAgentProviderRoutingEnabled: true,
        };
        expect(getConfiguredDefaultProvider()).toBe('copilot');
        expect(getDefaultProvider()).toBe('copilot');
        expect(isAutoAgentProviderRoutingEnabled()).toBe(true);
    });
});
