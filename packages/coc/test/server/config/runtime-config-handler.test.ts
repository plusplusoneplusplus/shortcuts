/**
 * Tests for runtime config handler (GET /api/config/runtime)
 * and ETag config-revision awareness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
        forEach: { enabled: false },
        vimNavigation: { enabled: false },
        loops: { enabled: false },
        excalidraw: { enabled: false },
        mcpOauth: { enabled: false },
        features: { focusedDiff: false, autoMemoryPromotion: false, gitCommitLookup: false, gitCrossCloneCherryPick: true, sessionContextAttachments: false, commitChatLens: false, ralphMultiAgentGrill: false },
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
        expect(result.features.pullRequestsAutoClassifyTeamEnabled).toBe(false);
        expect(result.features.serversEnabled).toBe(false);
        expect(result.features.ralphEnabled).toBe(false);
        expect(result.features.forEachEnabled).toBe(false);
        expect(result.features.vimNavigationEnabled).toBe(false);
        expect(result.features.loopsEnabled).toBe(false);
        expect(result.features.dreamsEnabled).toBe(false);
        expect(result.features.excalidrawEnabled).toBe(false);
        expect(result.features.mcpOauthEnabled).toBe(false);
        expect(result.features.focusedDiffEnabled).toBe(false);
        expect(result.features.gitCrossCloneCherryPickEnabled).toBe(true);
        expect(result.features.sessionContextAttachmentsEnabled).toBe(false);
        expect(result.features.commitChatLensEnabled).toBe(false);
        expect(result.features.autoAgentProviderRoutingEnabled).toBe(false);
        expect(result.features.ralphMultiAgentGrillEnabled).toBe(false);
        expect(result.features.codexEnabled).toBe(false);
        expect(result.features.defaultProvider).toBe('copilot');
        expect(result.features.workItemsSyncEnabled).toBe(false);
        expect(result.features.workItemsWorkflowEnabled).toBe(false);
    });

    it('reflects features.autoAgentProviderRouting = true from config', () => {
        const svc = createMockRuntimeConfigService({
            features: {
                focusedDiff: false,
                autoMemoryPromotion: false,
                gitCommitLookup: false,
                gitCrossCloneCherryPick: true,
                sessionContextAttachments: false,
                autoAgentProviderRouting: true,
            },
        } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.autoAgentProviderRoutingEnabled).toBe(true);
    });

    it('reflects features.ralphMultiAgentGrill = true from config', () => {
        const svc = createMockRuntimeConfigService({
            features: {
                focusedDiff: false,
                autoMemoryPromotion: false,
                gitCommitLookup: false,
                gitCrossCloneCherryPick: true,
                sessionContextAttachments: false,
                ralphMultiAgentGrill: true,
            },
        } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.ralphMultiAgentGrillEnabled).toBe(true);
    });

    it('reflects pullRequests.autoClassifyTeam = true from config', () => {
        const svc = createMockRuntimeConfigService({
            pullRequests: {
                enabled: true,
                suggestions: false,
                autoClassifyTeam: true,
            },
        } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.pullRequestsAutoClassifyTeamEnabled).toBe(true);
    });

    it('reports concrete defaultProvider while Auto routing is enabled', () => {
        const svc = createMockRuntimeConfigService({
            defaultProvider: 'claude',
            features: {
                focusedDiff: false,
                autoMemoryPromotion: false,
                gitCommitLookup: false,
                gitCrossCloneCherryPick: true,
                sessionContextAttachments: false,
                autoAgentProviderRouting: true,
            },
        } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.defaultProvider).toBe('claude');
        expect(result.features.autoAgentProviderRoutingEnabled).toBe(true);
    });

    it('reflects ralph.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ ralph: { enabled: true } });
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.ralphEnabled).toBe(true);
    });

    it('reflects forEach.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ forEach: { enabled: true } });
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.forEachEnabled).toBe(true);
    });

    it('reflects dreams.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ dreams: { enabled: true } });
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.dreamsEnabled).toBe(true);
    });

    it('defaults workItemsHierarchyEnabled to false', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.workItemsHierarchyEnabled).toBe(false);
    });

    it('reflects workItems.hierarchy.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ workItems: { hierarchy: { enabled: true } } } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.workItemsHierarchyEnabled).toBe(true);
    });

    it('defaults workItemsSyncEnabled to false', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.workItemsSyncEnabled).toBe(false);
    });

    it('reflects workItems.sync.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ workItems: { sync: { enabled: true } } } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.workItemsSyncEnabled).toBe(true);
    });

    it('defaults workItemsWorkflowEnabled to false', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.workItemsWorkflowEnabled).toBe(false);
    });

    it('reflects workItems.workflow.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ workItems: { workflow: { enabled: true } } } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.workItemsWorkflowEnabled).toBe(true);
    });

    it('defaults effortLevelsEnabled to false', () => {
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.effortLevelsEnabled).toBe(false);
    });

    it('reflects effortLevels.enabled = true from config', () => {
        const svc = createMockRuntimeConfigService({ effortLevels: { enabled: true } } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.effortLevelsEnabled).toBe(true);
    });

    it('reflects features.sessionContextAttachments = true from config', () => {
        const svc = createMockRuntimeConfigService({
            features: {
                focusedDiff: false,
                autoMemoryPromotion: false,
                gitCommitLookup: false,
                gitCrossCloneCherryPick: false,
                sessionContextAttachments: true,
            },
        } as any);
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.sessionContextAttachmentsEnabled).toBe(true);
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

describe('AC-06: env-driven prewarm debounce in runtime config', () => {
    const ENV = 'COC_WARM_PREWARM_DEBOUNCE_MS';
    let saved: string | undefined;

    beforeEach(() => { saved = process.env[ENV]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV];
        else process.env[ENV] = saved;
    });

    it('defaults prewarmDebounceMs to 500 when the env override is absent', () => {
        delete process.env[ENV];
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.prewarmDebounceMs).toBe(500);
    });

    it('reflects COC_WARM_PREWARM_DEBOUNCE_MS from the environment', () => {
        process.env[ENV] = '900';
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.prewarmDebounceMs).toBe(900);
    });

    it('honors 0 (no debounce) from the environment', () => {
        process.env[ENV] = '0';
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.prewarmDebounceMs).toBe(0);
    });
});

describe('AC-01: env-driven warm-client TTL in runtime config', () => {
    const ENV = 'COC_WARM_CLIENT_TTL_MS';
    let saved: string | undefined;

    beforeEach(() => { saved = process.env[ENV]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV];
        else process.env[ENV] = saved;
    });

    it('defaults warmClientTtlMs to 300000 when the env override is absent', () => {
        delete process.env[ENV];
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.warmClientTtlMs).toBe(300000);
    });

    it('reflects COC_WARM_CLIENT_TTL_MS from the environment', () => {
        process.env[ENV] = '120000';
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.warmClientTtlMs).toBe(120000);
    });

    it('surfaces 0 when warming is disabled', () => {
        process.env[ENV] = '0';
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.warmClientTtlMs).toBe(0);
    });

    it('falls back to 300000 for an invalid (negative) env value', () => {
        process.env[ENV] = '-5';
        const svc = createMockRuntimeConfigService();
        const result = buildRuntimeDashboardConfig(svc, 'my-host', '127.0.0.1');
        expect(result.features.warmClientTtlMs).toBe(300000);
    });
});

describe('AC-01: workItems.hierarchy.enabled live enablement end-to-end', () => {
    it('workItems.hierarchy.enabled update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ac01-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            // Initial state: hierarchy enabled by default
            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.workItemsHierarchyEnabled).toBe(true);

            // Admin update disables hierarchy
            const updateResult = await svc.updateConfig({ 'workItems.hierarchy.enabled': false });
            expect(updateResult.config.workItems.hierarchy.enabled).toBe(false);

            // Runtime dashboard config now reflects hierarchy disabled
            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.workItemsHierarchyEnabled).toBe(false);

            // Verify the effect classifies the field as live
            const effect = updateResult.effects.find((e: { field: string }) => e.field === 'workItems.hierarchy.enabled');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('pullRequests.autoClassifyTeam update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ac01-pr-auto-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.pullRequestsAutoClassifyTeamEnabled).toBe(false);

            const updateResult = await svc.updateConfig({ 'pullRequests.autoClassifyTeam': true });
            expect(updateResult.config.pullRequests.autoClassifyTeam).toBe(true);

            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.pullRequestsAutoClassifyTeamEnabled).toBe(true);

            const effect = updateResult.effects.find((e: { field: string }) => e.field === 'pullRequests.autoClassifyTeam');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('workItems.sync.enabled update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ac01-sync-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.workItemsSyncEnabled).toBe(false);

            const updateResult = await svc.updateConfig({ 'workItems.sync.enabled': true });
            expect(updateResult.config.workItems.sync.enabled).toBe(true);

            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.workItemsSyncEnabled).toBe(true);

            const effect = updateResult.effects.find((e: { field: string }) => e.field === 'workItems.sync.enabled');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('workItems.workflow.enabled update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ac01-workflow-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.workItemsWorkflowEnabled).toBe(false);

            const updateResult = await svc.updateConfig({ 'workItems.workflow.enabled': true });
            expect(updateResult.config.workItems.workflow.enabled).toBe(true);

            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.workItemsWorkflowEnabled).toBe(true);

            const effect = updateResult.effects.find((e: { field: string }) => e.field === 'workItems.workflow.enabled');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});


describe('AC-01 effortLevels.enabled live enablement end-to-end', () => {
    it('effortLevels.enabled update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-effort-ac01-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            // Default: effortLevels disabled
            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.effortLevelsEnabled).toBe(false);

            // Admin enables effort tiers
            const updateResult = await svc.updateConfig({ 'effortLevels.enabled': true });
            expect(updateResult.config.effortLevels.enabled).toBe(true);

            // Runtime dashboard config now reflects enabled
            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.effortLevelsEnabled).toBe(true);

            // Field is classified as live (no restart required)
            const effect = updateResult.effects.find((e: { field: string }) => e.field === 'effortLevels.enabled');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('session context attachments feature flag', () => {
    it('features.sessionContextAttachments defaults disabled and updates through runtime config service', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-session-context-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.sessionContextAttachmentsEnabled).toBe(false);

            const updateResult = await svc.updateConfig({ 'features.sessionContextAttachments': true });
            expect(updateResult.config.features.sessionContextAttachments).toBe(true);

            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.sessionContextAttachmentsEnabled).toBe(true);

            const effect = updateResult.effects.find(e => e.field === 'features.sessionContextAttachments');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('commit chat lens feature flag', () => {
    it('features.commitChatLens defaults disabled and updates through runtime config service', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-commit-chat-lens-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.commitChatLensEnabled).toBe(false);

            const updateResult = await svc.updateConfig({ 'features.commitChatLens': true });
            expect(updateResult.config.features.commitChatLens).toBe(true);

            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.commitChatLensEnabled).toBe(true);

            const effect = updateResult.effects.find(e => e.field === 'features.commitChatLens');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
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

describe('forEach.enabled live enablement end-to-end', () => {
    it('forEach.enabled update through service is reflected in runtime dashboard config', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { RuntimeConfigService } = await import('../../../src/config/runtime-config-service');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-for-each-'));
        try {
            const configPath = path.join(tmpDir, 'config.yaml');
            const svc = new RuntimeConfigService({ configPath });

            const before = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(before.features.forEachEnabled).toBe(false);
            expect(before.revision).toBe(0);

            const updateResult = await svc.updateConfig({ 'forEach.enabled': true });
            expect(updateResult.config.forEach.enabled).toBe(true);
            expect(updateResult.revision).toBe(1);

            const after = buildRuntimeDashboardConfig(svc, 'test-host', '127.0.0.1');
            expect(after.features.forEachEnabled).toBe(true);
            expect(after.revision).toBe(1);

            const effect = updateResult.effects.find(e => e.field === 'forEach.enabled');
            expect(effect).toBeDefined();
            expect(effect!.runtime).toBe('live');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
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

    it('excalidraw.enabled and git feature flags are classified as live in admin config fields', async () => {
        const { ADMIN_CONFIG_FIELDS } = await import('../../../src/server/admin/admin-config-fields');
        const excalidrawField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'excalidraw.enabled');
        const focusedDiffField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'features.focusedDiff');
        const crossCloneField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'features.gitCrossCloneCherryPick');
        const sessionContextField = ADMIN_CONFIG_FIELDS.find(f => f.key === 'features.sessionContextAttachments');
        expect(excalidrawField).toBeDefined();
        expect(excalidrawField!.runtime).toBe('live');
        expect(focusedDiffField).toBeDefined();
        expect(focusedDiffField!.runtime).toBe('live');
        expect(crossCloneField).toBeDefined();
        expect(crossCloneField!.runtime).toBe('live');
        expect(sessionContextField).toBeDefined();
        expect(sessionContextField!.runtime).toBe('live');
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
