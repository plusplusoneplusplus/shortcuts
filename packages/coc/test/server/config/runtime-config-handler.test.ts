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
        expect(result.features.codexEnabled).toBe(false);
        expect(result.features.defaultProvider).toBe('copilot');
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

describe('AC-05: ralph.enabled live enablement end-to-end', () => {
    it('ralph.enabled update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        // Create a real service with a temp config file
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ac05-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            // Initial state: ralph disabled
            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.ralphEnabled).toBe(false);
            expect(before.revision).toBe(0);

            // Admin update enables ralph
            const updateResult = await svc.updateConfig({ 'ralph.enabled': true });
            expect(updateResult.config.ralph.enabled).toBe(true);
            expect(updateResult.revision).toBe(1);

            // Runtime dashboard config now reflects ralph enabled
            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.ralphEnabled).toBe(true);
            expect(after.revision).toBe(1);

            // Verify the effect classifies ralph as live (not restartRequired)
            const ralphEffect = updateResult.effects.find(e => e.field === 'ralph.enabled');
            expect(ralphEffect).toBeDefined();
            expect(ralphEffect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('stale ETag is invalidated when ralph.enabled changes', async () => {
        vi.resetModules();
        const { getBundleETag } = await import('../../../src/server/spa/html-template');

        // ETag before config change (revision 0) differs from after (revision 1)
        const etagBefore = getBundleETag(0);
        const etagAfter = getBundleETag(1);
        expect(etagBefore).not.toBe(etagAfter);
        // Browser 304 with old ETag will not match new ETag → fresh HTML served
    });

    it('ralph backend routes are always registered (not gated by startup config)', async () => {
        // Verify route registration files import ralph routes unconditionally
        const routesSrc = await import('fs').then(fs =>
            fs.readFileSync(
                require('path').resolve(__dirname, '../../../src/server/routes/index.ts'),
                'utf-8',
            ),
        );
        // Ralph route registration should not be inside an if block checking config
        expect(routesSrc).toContain('registerRalphRoutes(routes');
        expect(routesSrc).not.toMatch(/if\s*\(.*ralph.*\)\s*\{?\s*registerRalphRoutes/);
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

describe('AC-08: live-classified route registration', () => {
    it('diagram routes are always registered (not gated by excalidraw.enabled at startup)', async () => {
        const routesSrc = await import('fs').then(fs =>
            fs.readFileSync(
                require('path').resolve(__dirname, '../../../src/server/routes/index.ts'),
                'utf-8',
            ),
        );
        // registerDiagramRoutes must be called unconditionally
        expect(routesSrc).toContain('registerDiagramRoutes(routes');
        expect(routesSrc).not.toMatch(/if\s*\(.*excalidraw.*\)\s*\{?\s*registerDiagramRoutes/);
    });

    it('focused-diff classification routes are always registered (not gated by features.focusedDiff at startup)', async () => {
        const routesSrc = await import('fs').then(fs =>
            fs.readFileSync(
                require('path').resolve(__dirname, '../../../src/server/routes/index.ts'),
                'utf-8',
            ),
        );
        expect(routesSrc).toContain('registerPrClassificationRoutes(routes');
        expect(routesSrc).not.toMatch(/if\s*\(.*focusedDiff.*\)\s*\{?\s*registerPrClassificationRoutes/);
        expect(routesSrc).toContain('registerGenericClassificationRoutes(routes');
        expect(routesSrc).not.toMatch(/if\s*\(.*focusedDiff.*\)\s*\{?\s*registerGenericClassificationRoutes/);
    });

    it('excalidraw LLM tool visibility uses live getter (not startup boolean)', async () => {
        const routesSrc = await import('fs').then(fs =>
            fs.readFileSync(
                require('path').resolve(__dirname, '../../../src/server/routes/api-workspace-routes.ts'),
                'utf-8',
            ),
        );
        // Workspace routes should call getLiveFeatureFlags, not read a static excalidrawEnabled
        expect(routesSrc).toContain('getLiveFeatureFlags');
        expect(routesSrc).not.toMatch(/ctx\.excalidrawEnabled/);
    });

    it('excalidraw.enabled and features.focusedDiff are classified as live in admin config fields', async () => {
        const { ADMIN_CONFIG_FIELDS } = await import('../../../src/server/admin/admin-config-fields');
        const excalidrawField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'excalidraw.enabled');
        const focusedDiffField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'features.focusedDiff');
        expect(excalidrawField).toBeDefined();
        expect(excalidrawField!.runtime).toBe('live');
        expect(focusedDiffField).toBeDefined();
        expect(focusedDiffField!.runtime).toBe('live');
    });

    it('terminal.enabled and loops.enabled are classified as restartRequired', async () => {
        const { ADMIN_CONFIG_FIELDS } = await import('../../../src/server/admin/admin-config-fields');
        const terminalField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'terminal.enabled');
        const loopsField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'loops.enabled');
        expect(terminalField).toBeDefined();
        expect(terminalField!.runtime).toBe('restartRequired');
        expect(loopsField).toBeDefined();
        expect(loopsField!.runtime).toBe('restartRequired');
    });
});
