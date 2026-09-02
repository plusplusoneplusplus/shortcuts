/**
 * The queue used to read configuration three incompatible ways: values frozen
 * at startup, live getter callbacks, and no-argument `loadConfigFile()` calls
 * that always resolved `~/.coc/config.yaml`. These tests pin the replacement
 * boundary:
 *
 *  - a server started with an explicit `--config` path resolves queue settings
 *    from *that* file, even when a conflicting default-path config exists;
 *  - every setting classified `live` in `admin-setting-definitions.ts` is
 *    re-read after an admin edit, with no restart;
 *  - settings intentionally captured once stay captured;
 *  - repo-scoped preferences stay repo-scoped — the global port supplies only
 *    global values.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';
import { DEFAULT_CONFIG } from '../../src/config';
import {
    createQueueRuntimeConfig,
    createFixedQueueRuntimeConfig,
    resolveDefaultTimeoutMs,
    DEFAULT_QUEUE_RUNTIME_CONFIG,
} from '../../src/server/queue/queue-runtime-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-runtime-config-'));
    tmpDirs.push(dir);
    return dir;
}

/** Write a YAML config file at an explicit, non-default path. */
function writeConfigAt(dir: string, yaml: string): string {
    const configPath = path.join(dir, 'custom-config.yaml');
    fs.writeFileSync(configPath, yaml, 'utf8');
    return configPath;
}

afterEach(() => {
    for (const dir of tmpDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Authoritative source: non-default config path
// ---------------------------------------------------------------------------

describe('QueueRuntimeConfig — authoritative config path', () => {
    it('resolves skills and Ralph policy from an explicit config path, not the default one', () => {
        const dir = makeTempDir();
        const extraFolder = path.join(dir, 'team-skills');
        const configPath = writeConfigAt(dir, [
            'timeout: 42',
            'skills:',
            `  globalExtraFolders:`,
            `    - ${JSON.stringify(extraFolder)}`,
            '  autoDetectDefaultFolders: false',
            'ralph:',
            '  enabled: true',
            '  finalCheck:',
            '    maxGapFixLoops: 9',
            'chat:',
            '  followUpSuggestions:',
            '    enabled: false',
            '    count: 5',
            '  askUser:',
            '    enabled: false',
            '',
        ].join('\n'));

        const service = new RuntimeConfigService({ configPath });
        const queueConfig = createQueueRuntimeConfig(service);

        // Every value comes from the explicit file, and none of them match the
        // built-in defaults — so a fallback to `~/.coc/config.yaml` (or to
        // DEFAULT_CONFIG) would be visible here.
        expect(queueConfig.getSkillFolders()).toEqual({
            globalExtraFolders: [extraFolder],
            autoDetectDefaultFolders: false,
        });
        expect(queueConfig.getRalphFinalCheckPolicy()).toEqual({ maxGapFixLoops: 9 });
        expect(queueConfig.getDefaultTimeoutMs()).toBe(42_000);
        expect(queueConfig.getFollowUpSuggestions()).toEqual({ enabled: false, count: 5 });
        expect(queueConfig.getAskUser()).toEqual({ enabled: false });

        // Guard against the values silently equalling the defaults.
        expect(queueConfig.getRalphFinalCheckPolicy().maxGapFixLoops)
            .not.toBe(DEFAULT_CONFIG.ralph.finalCheck.maxGapFixLoops);
        expect(queueConfig.getAskUser().enabled)
            .not.toBe(DEFAULT_CONFIG.chat.askUser.enabled);
    });

    it('keeps two services on different paths independent', () => {
        const dirA = makeTempDir();
        const dirB = makeTempDir();
        const pathA = writeConfigAt(dirA, 'ralph:\n  finalCheck:\n    maxGapFixLoops: 2\n');
        const pathB = writeConfigAt(dirB, 'ralph:\n  finalCheck:\n    maxGapFixLoops: 11\n');

        const queueA = createQueueRuntimeConfig(new RuntimeConfigService({ configPath: pathA }));
        const queueB = createQueueRuntimeConfig(new RuntimeConfigService({ configPath: pathB }));

        expect(queueA.getRalphFinalCheckPolicy().maxGapFixLoops).toBe(2);
        expect(queueB.getRalphFinalCheckPolicy().maxGapFixLoops).toBe(11);
    });

    it('reads a pre-loaded fileConfig without touching disk', () => {
        const service = new RuntimeConfigService({
            fileConfig: {
                timeout: 5,
                ralph: { finalCheck: { maxGapFixLoops: 6 } },
                skills: { globalExtraFolders: ['/opt/skills'] },
            },
        });
        const queueConfig = createQueueRuntimeConfig(service);

        expect(queueConfig.getDefaultTimeoutMs()).toBe(5_000);
        expect(queueConfig.getRalphFinalCheckPolicy().maxGapFixLoops).toBe(6);
        expect(queueConfig.getSkillFolders().globalExtraFolders).toEqual(['/opt/skills']);
    });
});

// ---------------------------------------------------------------------------
// Live reads
// ---------------------------------------------------------------------------

describe('QueueRuntimeConfig — live updates', () => {
    let configPath: string;
    let service: RuntimeConfigService;

    beforeEach(() => {
        const dir = makeTempDir();
        configPath = writeConfigAt(dir, 'timeout: 30\n');
        service = new RuntimeConfigService({ configPath });
    });

    it('re-reads the execution timeout after an admin edit', async () => {
        const queueConfig = createQueueRuntimeConfig(service);
        expect(queueConfig.getDefaultTimeoutMs()).toBe(30_000);

        await service.updateConfig({ timeout: 90 });

        // Same port instance — no restart, no re-composition.
        expect(queueConfig.getDefaultTimeoutMs()).toBe(90_000);
    });

    it('re-reads follow-up suggestions after an admin edit', async () => {
        const queueConfig = createQueueRuntimeConfig(service);
        expect(queueConfig.getFollowUpSuggestions()).toEqual({ enabled: true, count: 3 });

        await service.updateConfig({
            'chat.followUpSuggestions.enabled': false,
            'chat.followUpSuggestions.count': 5,
        });

        expect(queueConfig.getFollowUpSuggestions()).toEqual({ enabled: false, count: 5 });
    });

    it('re-reads the Ask User toggle after an admin edit', async () => {
        const queueConfig = createQueueRuntimeConfig(service);
        expect(queueConfig.getAskUser()).toEqual({ enabled: true });

        await service.updateConfig({ 'chat.askUser.enabled': false });

        expect(queueConfig.getAskUser()).toEqual({ enabled: false });
    });

    it('re-reads the Ralph final-check loop cap after an admin edit', async () => {
        const queueConfig = createQueueRuntimeConfig(service);
        expect(queueConfig.getRalphFinalCheckPolicy().maxGapFixLoops)
            .toBe(DEFAULT_CONFIG.ralph.finalCheck.maxGapFixLoops);

        await service.updateConfig({ 'ralph.finalCheck.maxGapFixLoops': 8 });

        expect(queueConfig.getRalphFinalCheckPolicy().maxGapFixLoops).toBe(8);
    });

    it('re-reads skill folders after the config file changes on disk', () => {
        const queueConfig = createQueueRuntimeConfig(service);
        expect(queueConfig.getSkillFolders().globalExtraFolders).toEqual([]);

        fs.writeFileSync(
            configPath,
            'timeout: 30\nskills:\n  globalExtraFolders:\n    - /srv/shared-skills\n',
            'utf8',
        );
        // `skills.*` is not admin-editable, so it reaches the queue via the
        // service's disk refresh rather than through updateConfig().
        service.refresh();

        expect(queueConfig.getSkillFolders().globalExtraFolders).toEqual(['/srv/shared-skills']);
    });
});

// ---------------------------------------------------------------------------
// Restart boundary
// ---------------------------------------------------------------------------

describe('QueueRuntimeConfig — restart boundary', () => {
    it('holds fixed-adapter values steady across later config-service edits', async () => {
        const dir = makeTempDir();
        const configPath = writeConfigAt(dir, 'timeout: 30\n');
        const service = new RuntimeConfigService({ configPath });

        // A composition root that deliberately captures once (CLI / tests)
        // builds a fixed adapter. It must not track the service afterwards.
        const fixed = createFixedQueueRuntimeConfig({ defaultTimeoutMs: 30_000 });
        expect(fixed.getDefaultTimeoutMs()).toBe(30_000);

        await service.updateConfig({ timeout: 120 });

        expect(fixed.getDefaultTimeoutMs()).toBe(30_000);
        expect(createQueueRuntimeConfig(service).getDefaultTimeoutMs()).toBe(120_000);
    });

    it('exposes a frozen, immutable getter surface', () => {
        const queueConfig = createFixedQueueRuntimeConfig({ defaultTimeoutMs: 1_000 });
        expect(Object.isFrozen(queueConfig)).toBe(true);

        // Only typed getters — no persistence, revision, or admin surface leaks
        // into the queue.
        expect(Object.keys(queueConfig).sort()).toEqual([
            'getAskUser',
            'getDefaultTimeoutMs',
            'getFollowUpSuggestions',
            'getRalphFinalCheckPolicy',
            'getSkillFolders',
        ]);
    });
});

// ---------------------------------------------------------------------------
// Fixed adapter
// ---------------------------------------------------------------------------

describe('createFixedQueueRuntimeConfig', () => {
    it('falls back to DEFAULT_CONFIG, never to disk', () => {
        expect(DEFAULT_QUEUE_RUNTIME_CONFIG.getDefaultTimeoutMs()).toBe(DEFAULT_AI_TIMEOUT_MS);
        expect(DEFAULT_QUEUE_RUNTIME_CONFIG.getFollowUpSuggestions())
            .toEqual(DEFAULT_CONFIG.chat.followUpSuggestions);
        expect(DEFAULT_QUEUE_RUNTIME_CONFIG.getAskUser())
            .toEqual(DEFAULT_CONFIG.chat.askUser);
        expect(DEFAULT_QUEUE_RUNTIME_CONFIG.getRalphFinalCheckPolicy().maxGapFixLoops)
            .toBe(DEFAULT_CONFIG.ralph.finalCheck.maxGapFixLoops);
        // No global folders are invented for a caller that supplied no config.
        expect(DEFAULT_QUEUE_RUNTIME_CONFIG.getSkillFolders())
            .toEqual({ globalExtraFolders: undefined, autoDetectDefaultFolders: undefined });
    });

    it('derives every setting from a config the caller resolved itself', () => {
        const queueConfig = createFixedQueueRuntimeConfig({
            config: {
                timeout: 15,
                chat: { followUpSuggestions: { enabled: false, count: 1 }, askUser: { enabled: false } },
                skills: { globalExtraFolders: ['/a'], autoDetectDefaultFolders: false },
                ralph: { finalCheck: { maxGapFixLoops: 4 } },
            },
        });

        expect(queueConfig.getDefaultTimeoutMs()).toBe(15_000);
        expect(queueConfig.getFollowUpSuggestions()).toEqual({ enabled: false, count: 1 });
        expect(queueConfig.getAskUser()).toEqual({ enabled: false });
        expect(queueConfig.getSkillFolders())
            .toEqual({ globalExtraFolders: ['/a'], autoDetectDefaultFolders: false });
        expect(queueConfig.getRalphFinalCheckPolicy()).toEqual({ maxGapFixLoops: 4 });
    });

    it('lets direct overrides win over the supplied config', () => {
        const queueConfig = createFixedQueueRuntimeConfig({
            config: { timeout: 15, chat: { askUser: { enabled: false } } },
            defaultTimeoutMs: 777,
            askUser: { enabled: true },
        });

        expect(queueConfig.getDefaultTimeoutMs()).toBe(777);
        expect(queueConfig.getAskUser()).toEqual({ enabled: true });
    });

    it('converts the config timeout from seconds to milliseconds', () => {
        expect(resolveDefaultTimeoutMs(undefined)).toBe(DEFAULT_AI_TIMEOUT_MS);
        expect(resolveDefaultTimeoutMs(0)).toBe(DEFAULT_AI_TIMEOUT_MS);
        expect(resolveDefaultTimeoutMs(60)).toBe(60_000);
    });
});
