/**
 * Tests for runtime config handler (GET /api/config/runtime)
 * and ETag config-revision awareness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRuntimeDashboardConfig } from '../../../src/server/config/runtime-config-handler';
import type { RuntimeConfigService } from '../../../src/config/runtime-config-service';
import type { ResolvedCLIConfig } from '../../../src/config';

function createMockRuntimeConfigService(overrides: Partial<ResolvedCLIConfig> = {}, revision = 0): RuntimeConfigService {
    const config: ResolvedCLIConfig = {
        model: 'test-model',
        parallel: 1,
        timeout: 30,
        output: 'table',
        showReportIntent: false,
        toolCompactness: 1,
        taskCardDensity: 'compact',
        historyGrouping: true,
        groupSingleLineMessages: false,
        chat: { followUpSuggestions: { enabled: false, count: 3 }, askUser: { enabled: false } },
        serve: { serverName: undefined },
        terminal: { enabled: true },
        notes: { enabled: true },
        myWork: { enabled: false },
        myLife: { enabled: false },
        scratchpad: { enabled: false, layout: 'horizontal' },
        workflows: { enabled: false },
        pullRequests: { enabled: false },
        servers: { enabled: false },
        ralph: { enabled: false },
        vimNavigation: { enabled: false },
        loops: { enabled: false },
        excalidraw: { enabled: false },
        mcpOauth: { enabled: false },
        features: { focusedDiff: false, autoMemoryPromotion: false },
        memoryPromotion: { enabled: false },
        defaultModels: {},
        ...overrides,
    } as unknown as ResolvedCLIConfig;

    return {
        config,
        revision,
        sources: {},
        configPath: '/mock/config.yaml',
        getSnapshot: () => ({ config, sources: {}, revision }),
    } as unknown as RuntimeConfigService;
}

describe('buildRuntimeDashboardConfig', () => {
    it('returns revision from the service', () => {
        const svc = createMockRuntimeConfigService({}, 5);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.revision).toBe(5);
    });

    it('returns all feature flags with correct defaults', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');

        expect(result.features.terminalEnabled).toBe(true);
        expect(result.features.notesEnabled).toBe(true);
        expect(result.features.myWorkEnabled).toBe(false);
        expect(result.features.myLifeEnabled).toBe(false);
        expect(result.features.scratchpadEnabled).toBe(false);
        expect(result.features.scratchpadLayout).toBe('horizontal');
        expect(result.features.workflowsEnabled).toBe(false);
        expect(result.features.pullRequestsEnabled).toBe(false);
        expect(result.features.serversEnabled).toBe(false);
        expect(result.features.ralphEnabled).toBe(false);
        expect(result.features.vimNavigationEnabled).toBe(false);
        expect(result.features.loopsEnabled).toBe(false);
        expect(result.features.excalidrawEnabled).toBe(false);
        expect(result.features.mcpOauthEnabled).toBe(false);
        expect(result.features.focusedDiffEnabled).toBe(false);
    });

    it('reflects ralph.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ ralph: { enabled: true } });
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.ralphEnabled).toBe(true);
    });

    it('uses serve.serverName for hostname when set', () => {
        const svc = createMockRuntimeConfigService({ serve: { serverName: 'custom-name' } } as any);
        const result = buildRuntimeDashboardConfig(svc, 'raw-hostname.local', '127.0.0.1');
        expect(result.hostname).toBe('custom-name');
    });

    it('falls back to shortened raw hostname when serve.serverName is not set', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'raw-hostname.local', '0.0.0.0');
        expect(result.hostname).toBe('raw-hostname');
        expect(result.bindAddress).toBe('0.0.0.0');
    });

    it('does not expose secrets or raw config file paths', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'h', '127.0.0.1');
        const json = JSON.stringify(result);
        expect(json).not.toContain('configPath');
        expect(json).not.toContain('test-model');
    });
});

describe('getBundleETag with config revision', () => {
    let getBundleETag: (configRevision?: number) => string;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../../src/server/spa/html-template');
        getBundleETag = mod.getBundleETag;
    });

    it('returns same ETag for same revision', () => {
        const etag1 = getBundleETag(0);
        const etag2 = getBundleETag(0);
        expect(etag1).toBe(etag2);
    });

    it('returns different ETag for different revisions', () => {
        const etag0 = getBundleETag(0);
        const etag1 = getBundleETag(1);
        expect(etag0).not.toBe(etag1);
    });

    it('treats undefined revision as 0', () => {
        const etagUndef = getBundleETag();
        const etag0 = getBundleETag(0);
        expect(etagUndef).toBe(etag0);
    });

    it('invalidates cache when revision bumps', () => {
        const etag1 = getBundleETag(1);
        const etag2 = getBundleETag(2);
        const etag1Again = getBundleETag(1);
        expect(etag1).not.toBe(etag2);
        expect(etag1Again).toBe(etag1);
    });
});
