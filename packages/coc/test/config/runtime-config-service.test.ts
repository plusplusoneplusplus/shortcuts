/**
 * Runtime Config Service Tests
 *
 * Tests for the central runtime config service that owns config loading,
 * validation, persistence, resolved snapshots, source metadata, and revisioning.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

import { RuntimeConfigService } from '../../src/config/runtime-config-service';
import type { RuntimeConfigSnapshot } from '../../src/config/runtime-config-service';
import { DEFAULT_CONFIG } from '../../src/config';
import type { CLIConfig } from '../../src/config';

describe('RuntimeConfigService', () => {
    let tmpDir: string;
    let configPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rtcfg-'));
        configPath = path.join(tmpDir, 'config.yaml');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeConfig(config: CLIConfig): void {
        fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1 }), 'utf-8');
    }

    // ── Constructor / Initialization ─────────────────────────────────────

    describe('initialization', () => {
        it('should resolve defaults when no config file exists', () => {
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.config.parallel).toBe(DEFAULT_CONFIG.parallel);
            expect(svc.config.pullRequests.enabled).toBe(true);
            expect(svc.config.servers.enabled).toBe(true);
            expect(svc.config.ralph.enabled).toBe(false);
            expect(svc.config.forEach.enabled).toBe(false);
            expect(svc.config.features.gitCrossCloneCherryPick).toBe(true);
            expect(svc.config.features.commitChatLens).toBe(false);
            expect(svc.config.features.autoAgentProviderRouting).toBe(false);
            expect(svc.config.defaultProvider).toBe('copilot');
            expect(svc.config.agentProviderRouting.auto.rules.map(rule => rule.provider)).toEqual(['claude', 'codex', 'copilot']);
            expect(svc.config.agentProviderRouting.auto.rules.map(rule => rule.minimumRemainingPercent)).toEqual([33, 33, 10]);
            expect(svc.config.agentProviderRouting.auto.rules.map(rule => rule.weeklyGuard.minimumRemainingPercent)).toEqual([33, 33, 10]);
            expect(svc.config.agentProviderRouting.auto.fallbackProvider).toBe('copilot');
            expect(svc.revision).toBe(0);
        });

        it('should load config from file at construction', () => {
            writeConfig({ parallel: 10, ralph: { enabled: true }, forEach: { enabled: true } });
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.config.parallel).toBe(10);
            expect(svc.config.ralph.enabled).toBe(true);
            expect(svc.config.forEach.enabled).toBe(true);
            expect(svc.revision).toBe(0);
        });

        it('should track sources correctly', () => {
            writeConfig({ ralph: { enabled: true } });
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.sources['ralph.enabled']).toBe('file');
            expect(svc.sources['forEach.enabled']).toBe('default');
            // parallel is not in file, should be default
            expect(svc.sources['parallel']).toBe('default');
        });

        it('should expose configPath', () => {
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.configPath).toBe(configPath);
        });

        it('should use fileConfig when provided instead of reading from disk', () => {
            // Write a config file with ralph enabled
            writeConfig({ ralph: { enabled: true }, parallel: 99 });
            // But pass fileConfig that disables ralph and sets different parallel
            const svc = new RuntimeConfigService({
                configPath,
                fileConfig: { ralph: { enabled: false }, parallel: 5 },
            });
            // fileConfig should win over file on disk
            expect(svc.config.ralph.enabled).toBe(false);
            expect(svc.config.parallel).toBe(5);
        });

        it('should merge fileConfig with defaults', () => {
            const svc = new RuntimeConfigService({
                fileConfig: { excalidraw: { enabled: true } },
            });
            expect(svc.config.excalidraw.enabled).toBe(true);
            // Other defaults should still be applied
            expect(svc.config.parallel).toBe(DEFAULT_CONFIG.parallel);
        });
    });

    // ── getSnapshot ──────────────────────────────────────────────────────

    describe('getSnapshot', () => {
        it('should return config, sources, and revision', () => {
            const svc = new RuntimeConfigService({ configPath });
            const snap = svc.getSnapshot();
            expect(snap.config).toBeDefined();
            expect(snap.sources).toBeDefined();
            expect(snap.revision).toBe(0);
        });

        it('should return a copy of sources', () => {
            const svc = new RuntimeConfigService({ configPath });
            const snap1 = svc.getSnapshot();
            const snap2 = svc.getSnapshot();
            expect(snap1.sources).not.toBe(snap2.sources);
            expect(snap1.sources).toEqual(snap2.sources);
        });
    });

    // ── refresh ──────────────────────────────────────────────────────────

    describe('refresh', () => {
        it('should re-read config from disk without incrementing revision', () => {
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.config.ralph.enabled).toBe(false);

            // External write
            writeConfig({ ralph: { enabled: true } });
            svc.refresh();

            expect(svc.config.ralph.enabled).toBe(true);
            expect(svc.revision).toBe(0); // revision unchanged
        });
    });

    // ── updateConfig ─────────────────────────────────────────────────────

    describe('updateConfig', () => {
        it('should apply valid update and increment revision', async () => {
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.config.ralph.enabled).toBe(false);
            expect(svc.revision).toBe(0);

            const result = await svc.updateConfig({ 'ralph.enabled': true });

            expect(result.config.ralph.enabled).toBe(true);
            expect(result.revision).toBe(1);
            expect(svc.config.ralph.enabled).toBe(true);
            expect(svc.revision).toBe(1);
        });

        it('should persist changes to disk', async () => {
            const svc = new RuntimeConfigService({ configPath });
            await svc.updateConfig({ 'ralph.enabled': true });

            // Read back from disk independently
            const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as CLIConfig;
            expect(raw.ralph?.enabled).toBe(true);
        });

        it('should return effects for changed fields', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const result = await svc.updateConfig({
                'ralph.enabled': true,
                'loops.enabled': true,
                'forEach.enabled': true,
            });

            expect(result.effects).toHaveLength(3);
            const fieldNames = result.effects.map(e => e.field).sort();
            expect(fieldNames).toEqual(['forEach.enabled', 'loops.enabled', 'ralph.enabled']);
        });

        it('should update source metadata after write', async () => {
            const svc = new RuntimeConfigService({ configPath });
            expect(svc.sources['ralph.enabled']).toBe('default');

            await svc.updateConfig({ 'ralph.enabled': true });
            expect(svc.sources['ralph.enabled']).toBe('file');
        });

        it('should reject invalid field values without mutating disk or revision', async () => {
            writeConfig({ parallel: 5 });
            const svc = new RuntimeConfigService({ configPath });

            await expect(
                svc.updateConfig({ 'parallel': -1 }),
            ).rejects.toThrow('parallel must be a number greater than 0');

            expect(svc.revision).toBe(0);

            // Disk should be unchanged
            const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as CLIConfig;
            expect(raw.parallel).toBe(5);
        });

        it('should reject patch with no valid editable fields', async () => {
            const svc = new RuntimeConfigService({ configPath });
            await expect(
                svc.updateConfig({ 'nonexistent.field': 42 }),
            ).rejects.toThrow('No valid editable fields');
        });

        it('should reject defaultProvider auto while auto routing feature is disabled', async () => {
            writeConfig({ parallel: 5 });
            const svc = new RuntimeConfigService({ configPath });

            await expect(
                svc.updateConfig({ defaultProvider: 'auto' }),
            ).rejects.toThrow('defaultProvider "auto" requires features.autoAgentProviderRouting: true');

            expect(svc.revision).toBe(0);
            expect(svc.config.defaultProvider).toBe('copilot');

            const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as CLIConfig;
            expect(raw.defaultProvider).toBeUndefined();
            expect(raw.features?.autoAgentProviderRouting).toBeUndefined();
        });

        it('should allow enabling auto routing and selecting defaultProvider auto in the same update', async () => {
            const svc = new RuntimeConfigService({ configPath });

            const result = await svc.updateConfig({
                'features.autoAgentProviderRouting': true,
                defaultProvider: 'auto',
            });

            expect(result.config.features.autoAgentProviderRouting).toBe(true);
            expect(result.config.defaultProvider).toBe('auto');
            expect(result.sources['features.autoAgentProviderRouting']).toBe('file');
            expect(result.sources.defaultProvider).toBe('file');
            expect(result.revision).toBe(1);

            const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as CLIConfig;
            expect(raw.features?.autoAgentProviderRouting).toBe(true);
            expect(raw.defaultProvider).toBe('auto');
        });

        it('should handle multiple sequential updates correctly', async () => {
            const svc = new RuntimeConfigService({ configPath });

            await svc.updateConfig({ 'ralph.enabled': true });
            expect(svc.revision).toBe(1);

            await svc.updateConfig({ 'loops.enabled': true });
            expect(svc.revision).toBe(2);

            await svc.updateConfig({ 'forEach.enabled': true });
            expect(svc.revision).toBe(3);

            expect(svc.config.ralph.enabled).toBe(true);
            expect(svc.config.loops.enabled).toBe(true);
            expect(svc.config.forEach.enabled).toBe(true);
        });

        it('should serialize concurrent updates', async () => {
            const svc = new RuntimeConfigService({ configPath });

            // Fire two updates concurrently
            const [r1, r2] = await Promise.all([
                svc.updateConfig({ 'ralph.enabled': true }),
                svc.updateConfig({ 'loops.enabled': true }),
            ]);

            // Both should succeed with sequential revisions
            expect(r1.revision).toBe(1);
            expect(r2.revision).toBe(2);
            expect(svc.revision).toBe(2);
            expect(svc.config.ralph.enabled).toBe(true);
            expect(svc.config.loops.enabled).toBe(true);
        });
    });

    // ── Listeners ────────────────────────────────────────────────────────

    describe('onChange', () => {
        it('should notify listeners on successful update', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const snapshots: RuntimeConfigSnapshot[] = [];

            svc.onChange(snap => snapshots.push(snap));
            await svc.updateConfig({ 'ralph.enabled': true });

            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].config.ralph.enabled).toBe(true);
            expect(snapshots[0].revision).toBe(1);
        });

        it('should not notify listeners on failed update', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const snapshots: RuntimeConfigSnapshot[] = [];

            svc.onChange(snap => snapshots.push(snap));
            await svc.updateConfig({ 'parallel': -1 }).catch(() => {});

            expect(snapshots).toHaveLength(0);
        });

        it('should support unsubscribe', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const snapshots: RuntimeConfigSnapshot[] = [];

            const unsub = svc.onChange(snap => snapshots.push(snap));
            await svc.updateConfig({ 'ralph.enabled': true });
            expect(snapshots).toHaveLength(1);

            unsub();
            await svc.updateConfig({ 'loops.enabled': true });
            expect(snapshots).toHaveLength(1); // not called again
        });

        it('should tolerate listener errors', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const snapshots: RuntimeConfigSnapshot[] = [];

            svc.onChange(() => { throw new Error('boom'); });
            svc.onChange(snap => snapshots.push(snap));

            await svc.updateConfig({ 'ralph.enabled': true });
            expect(snapshots).toHaveLength(1); // second listener still called
        });

        it('should clear all listeners with removeAllListeners', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const snapshots: RuntimeConfigSnapshot[] = [];

            svc.onChange(snap => snapshots.push(snap));
            svc.removeAllListeners();

            await svc.updateConfig({ 'ralph.enabled': true });
            expect(snapshots).toHaveLength(0);
        });
    });

    // ── Config precedence ────────────────────────────────────────────────

    describe('config precedence', () => {
        it('should preserve existing config values when updating unrelated fields', async () => {
            writeConfig({ parallel: 10, ralph: { enabled: true } });
            const svc = new RuntimeConfigService({ configPath });

            await svc.updateConfig({ 'loops.enabled': true });

            // Pre-existing values should be preserved
            expect(svc.config.parallel).toBe(10);
            expect(svc.config.ralph.enabled).toBe(true);
            expect(svc.config.loops.enabled).toBe(true);
        });

        it('should preserve non-admin fields in config file', async () => {
            writeConfig({ model: 'gpt-4o', timeout: 300 });
            const svc = new RuntimeConfigService({ configPath });

            await svc.updateConfig({ 'ralph.enabled': true });

            // Read back from disk — model should still be there
            const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as CLIConfig;
            expect(raw.model).toBe('gpt-4o');
            expect(raw.timeout).toBe(300);
        });
    });

    // ── Field runtime classification ─────────────────────────────────────

    describe('field runtime classification', () => {
        it('should return correct runtime classification in effects for live fields', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const result = await svc.updateConfig({ 'ralph.enabled': true });

            const ralphEffect = result.effects.find(e => e.field === 'ralph.enabled');
            expect(ralphEffect).toBeDefined();
            expect(ralphEffect!.runtime).toBe('live');
            expect(ralphEffect!.requiresRestart).toBe(false);
        });

        it('should return restartRequired classification for infrastructure fields', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const result = await svc.updateConfig({ 'loops.enabled': true });

            const loopsEffect = result.effects.find(e => e.field === 'loops.enabled');
            expect(loopsEffect).toBeDefined();
            expect(loopsEffect!.runtime).toBe('restartRequired');
            expect(loopsEffect!.requiresRestart).toBe(true);
        });

        it('should return mixed classifications for mixed updates', async () => {
            const svc = new RuntimeConfigService({ configPath });
            const result = await svc.updateConfig({
                'ralph.enabled': true,
                'loops.enabled': true,
                'terminal.enabled': false,
            });

            expect(result.effects).toHaveLength(3);

            const ralph = result.effects.find(e => e.field === 'ralph.enabled')!;
            expect(ralph.runtime).toBe('live');
            expect(ralph.requiresRestart).toBe(false);

            const loops = result.effects.find(e => e.field === 'loops.enabled')!;
            expect(loops.runtime).toBe('restartRequired');
            expect(loops.requiresRestart).toBe(true);

            const terminal = result.effects.find(e => e.field === 'terminal.enabled')!;
            expect(terminal.runtime).toBe('restartRequired');
            expect(terminal.requiresRestart).toBe(true);
        });
    });
});
