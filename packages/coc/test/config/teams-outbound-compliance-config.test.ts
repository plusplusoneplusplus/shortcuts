import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config';
import { CLIConfigSchema } from '../../src/config/schema';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';

const prompt = 'Allow only public information.\nBlock confidential information.';

describe('Teams outbound compliance configuration', () => {
    let directory: string | undefined;
    afterEach(() => {
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
        directory = undefined;
    });

    function service(): RuntimeConfigService {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-compliance-config-'));
        return new RuntimeConfigService({ configPath: path.join(directory, 'config.yaml') });
    }

    it('defaults off and merges policy independently of trigger and workspace settings', () => {
        expect(DEFAULT_CONFIG.features.teamsOutboundCompliance).toBe(false);
        expect(DEFAULT_CONFIG.teamsOutboundCompliance).toEqual({ prompt: '' });
        const base = mergeConfig(DEFAULT_CONFIG, {
            teamsOutboundCompliance: { prompt },
            teamsIc3OwnCommands: { workspaceId: 'workspace-alpha' },
        });
        const next = mergeConfig(base, { features: { teamsOutboundCompliance: true } });
        expect(next.teamsOutboundCompliance).toEqual({ prompt });
        expect(next.teamsIc3OwnCommands.workspaceId).toBe('workspace-alpha');
        expect(next.features.teamsIc3OwnCommands).toBe(false);
        expect(next.features.teamsReactionDelegation).toBe(false);
        expect(base.features.teamsOutboundCompliance).toBe(false);
        expect(mergeConfig(next, { teamsOutboundCompliance: { prompt: 'Replacement policy' } })
            .teamsOutboundCompliance.prompt).toBe('Replacement policy');
    });

    it.each([undefined, '', ' ', '\t\r\n'])('rejects enabled file configuration with a blank prompt: %j', value => {
        const parsed = CLIConfigSchema.safeParse({
            features: { teamsOutboundCompliance: true }, teamsOutboundCompliance: { prompt: value },
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({
            path: ['teamsOutboundCompliance', 'prompt'], message: expect.stringContaining('nonblank'),
        }));
    });

    it('accepts disabled drafts and enabled multiline policy without rewriting it', () => {
        expect(CLIConfigSchema.safeParse({ teamsOutboundCompliance: { prompt: ' \n' } }).success).toBe(true);
        expect(CLIConfigSchema.parse({
            features: { teamsOutboundCompliance: true }, teamsOutboundCompliance: { prompt },
        }).teamsOutboundCompliance?.prompt).toBe(prompt);
    });

    it.each([null, true, 1, {}])('rejects non-string file prompts: %j', value => {
        expect(CLIConfigSchema.safeParse({ teamsOutboundCompliance: { prompt: value } }).success).toBe(false);
    });

    it('rejects incomplete enablement without persistence or live notifications', async () => {
        const config = service();
        const changed = vi.fn();
        config.onChange(changed);
        await expect(config.updateConfig({ 'features.teamsOutboundCompliance': true })).rejects.toThrow(/nonblank/);
        expect(fs.existsSync(config.configPath)).toBe(false);
        expect(config.revision).toBe(0);
        expect(changed).not.toHaveBeenCalled();
        expect(config.config.features.teamsOutboundCompliance).toBe(false);
    });

    it('persists and reloads policy, validates merged updates, and publishes live snapshots to all consumers', async () => {
        const config = service();
        const workspaceAlpha = vi.fn();
        const workspaceBeta = vi.fn();
        config.onChange(workspaceAlpha);
        config.onChange(workspaceBeta);
        const result = await config.updateConfig({
            'features.teamsOutboundCompliance': true,
            'teamsOutboundCompliance.prompt': prompt,
        });
        expect(result.effects).toHaveLength(2);
        expect(result.effects.every(effect => effect.runtime === 'live' && !effect.requiresRestart)).toBe(true);
        expect(result.sources['teamsOutboundCompliance.prompt']).toBe('file');
        expect(result.sources['features.teamsOutboundCompliance']).toBe('file');
        expect(workspaceAlpha).toHaveBeenCalledTimes(1);
        expect(workspaceBeta).toHaveBeenCalledWith(workspaceAlpha.mock.calls[0][0]);
        expect(workspaceAlpha.mock.calls[0][0].config.teamsOutboundCompliance).toEqual({ prompt });
        const saved = fs.readFileSync(config.configPath, 'utf8');
        await expect(config.updateConfig({ 'teamsOutboundCompliance.prompt': ' \n' })).rejects.toThrow(/nonblank/);
        await expect(config.updateConfig({ 'teamsOutboundCompliance.prompt': null })).rejects.toThrow();
        expect(config.revision).toBe(1);
        expect(workspaceAlpha).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(config.configPath, 'utf8')).toBe(saved);
        const reloaded = new RuntimeConfigService({ configPath: config.configPath });
        expect(reloaded.config.features.teamsOutboundCompliance).toBe(true);
        expect(reloaded.config.teamsOutboundCompliance).toEqual({ prompt });
        await config.updateConfig({ 'teamsOutboundCompliance.prompt': 'New policy' });
        expect(config.config.teamsOutboundCompliance.prompt).toBe('New policy');
        await config.updateConfig({
            'features.teamsOutboundCompliance': false, 'teamsOutboundCompliance.prompt': '',
        });
        config.refresh();
        expect(config.config.features.teamsOutboundCompliance).toBe(false);
        expect(config.config.teamsOutboundCompliance.prompt).toBe('');
        expect(workspaceAlpha).toHaveBeenCalledTimes(3);
        expect(workspaceBeta).toHaveBeenCalledTimes(3);
    });
});
