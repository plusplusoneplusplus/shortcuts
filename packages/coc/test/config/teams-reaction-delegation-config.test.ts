import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config';
import { CLIConfigSchema, validateConfigWithSchema } from '../../src/config/schema';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';
import { ADMIN_CONFIG_FIELDS } from '../../src/server/admin/admin-config-fields';

const binding = { workspaceId: 'workspace-alpha', dispatcherSkill: 'task-dispatcher' };

describe('Teams reaction delegation settings', () => {
    it('defaults off with no implicit workspace or dispatcher', () => {
        expect(DEFAULT_CONFIG.features.teamsReactionDelegation).toBe(false);
        expect(DEFAULT_CONFIG.teamsReactionDelegation).toEqual({ workspaceId: '', dispatcherSkill: '' });
        expect(mergeConfig(DEFAULT_CONFIG, {}).teamsReactionDelegation).toEqual(DEFAULT_CONFIG.teamsReactionDelegation);
    });

    it('merges workspace and dispatcher independently without enabling delegation or changing own commands', () => {
        const base = mergeConfig(DEFAULT_CONFIG, {
            teamsReactionDelegation: binding,
            teamsIc3OwnCommands: { workspaceId: 'workspace-commands' },
        });
        const next = mergeConfig(base, { teamsReactionDelegation: { workspaceId: 'workspace-beta' } });
        expect(next.teamsReactionDelegation).toEqual({ ...binding, workspaceId: 'workspace-beta' });
        expect(next.teamsIc3OwnCommands.workspaceId).toBe('workspace-commands');
        expect(next.features.teamsReactionDelegation).toBe(false);
        expect(base.teamsReactionDelegation).toEqual(binding);
        expect(mergeConfig(next, { teamsReactionDelegation: { dispatcherSkill: 'other-dispatcher' } })
            .teamsReactionDelegation).toEqual({ workspaceId: 'workspace-beta', dispatcherSkill: 'other-dispatcher' });
    });

    it.each([undefined, {}, { workspaceId: '' }, { workspaceId: binding.workspaceId }, { dispatcherSkill: binding.dispatcherSkill }])(
        'rejects enabling with an incomplete binding: %j', teamsReactionDelegation => {
            expect(() => validateConfigWithSchema({
                features: { teamsReactionDelegation: true }, teamsReactionDelegation,
            })).toThrow(/teamsReactionDelegation\.(workspaceId|dispatcherSkill): Required/);
        },
    );

    it('permits disabled drafts and enabling only with both selections', () => {
        expect(CLIConfigSchema.safeParse({ teamsReactionDelegation: { workspaceId: binding.workspaceId } }).success).toBe(true);
        expect(CLIConfigSchema.safeParse({
            features: { teamsReactionDelegation: true }, teamsReactionDelegation: binding,
        }).success).toBe(true);
    });

    it.each([
        ['workspaceId', '../invalid'],
        ['workspaceId', 'remote:server:workspace'],
        ['workspaceId', 'a'.repeat(257)],
        ['workspaceId', 'workspace\n'],
        ['workspaceId', ' workspace'],
        ['workspaceId', null],
        ['dispatcherSkill', '../dispatcher'],
        ['dispatcherSkill', 'folder\\dispatcher'],
        ['dispatcherSkill', '/absolute/dispatcher'],
        ['dispatcherSkill', '.'],
        ['dispatcherSkill', '..'],
        ['dispatcherSkill', ' dispatcher'],
        ['dispatcherSkill', 'dispatcher\n'],
        ['dispatcherSkill', 'a'.repeat(257)],
        ['dispatcherSkill', null],
    ])('rejects malformed %s in both file and admin validation: %j', (field, value) => {
        expect(CLIConfigSchema.safeParse({ teamsReactionDelegation: { [field]: value } }).success).toBe(false);
        const definition = ADMIN_CONFIG_FIELDS.find(def => def.key === `teamsReactionDelegation.${field}`)!;
        expect(definition.validate(value)).toBeTypeOf('string');
    });

    it.each(['region', 'token', 'permissions', 'provider', 'model', 'mode', 'skillSource', 'autoMerge'])(
        'rejects an unsupported independent %s setting', field => {
            expect(CLIConfigSchema.safeParse({ teamsReactionDelegation: { ...binding, [field]: 'unsupported' } }).success).toBe(false);
        },
    );

    it.each(['task-dispatcher', 'dispatcher_v2', 'Dispatcher.V2'])('accepts a named dispatcher: %s', dispatcherSkill => {
        expect(CLIConfigSchema.safeParse({ teamsReactionDelegation: { dispatcherSkill } }).success).toBe(true);
        expect(ADMIN_CONFIG_FIELDS.find(def => def.key === 'teamsReactionDelegation.dispatcherSkill')!
            .validate(dispatcherSkill)).toBeUndefined();
    });
});

describe('Teams reaction delegation admin persistence', () => {
    let directory: string | undefined;
    afterEach(() => {
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
        directory = undefined;
    });

    function service(): RuntimeConfigService {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-reaction-config-'));
        return new RuntimeConfigService({ configPath: path.join(directory, 'config.yaml') });
    }

    it('rejects incomplete enablement without writes, revisions or notifications', async () => {
        const config = service();
        const listener = vi.fn();
        config.onChange(listener);
        await expect(config.updateConfig({ 'features.teamsReactionDelegation': true })).rejects.toThrow(/Required/);
        expect(fs.existsSync(config.configPath)).toBe(false);
        expect(config.revision).toBe(0);
        expect(listener).not.toHaveBeenCalled();
        expect(config.config.features.teamsReactionDelegation).toBe(false);
    });

    it('persists a complete binding and validates partial updates against saved configuration', async () => {
        const config = service();
        const result = await config.updateConfig({
            'features.teamsReactionDelegation': true,
            'teamsReactionDelegation.workspaceId': binding.workspaceId,
            'teamsReactionDelegation.dispatcherSkill': binding.dispatcherSkill,
        });
        expect(result.config.teamsReactionDelegation).toEqual(binding);
        expect(result.effects).toHaveLength(3);
        expect(result.effects.every(effect => effect.runtime === 'live' && !effect.requiresRestart)).toBe(true);
        expect(result.sources['teamsReactionDelegation.dispatcherSkill']).toBe('file');
        const before = fs.readFileSync(config.configPath, 'utf8');
        await expect(config.updateConfig({ 'teamsReactionDelegation.dispatcherSkill': '' })).rejects.toThrow(/Required/);
        await expect(config.updateConfig({ 'teamsReactionDelegation.workspaceId': '' })).rejects.toThrow(/Required/);
        expect(fs.readFileSync(config.configPath, 'utf8')).toBe(before);
        expect(config.revision).toBe(1);
        await config.updateConfig({ 'teamsReactionDelegation.workspaceId': 'workspace-beta' });
        expect(config.config.teamsReactionDelegation).toEqual({ ...binding, workspaceId: 'workspace-beta' });
        const disabled = await config.updateConfig({
            'features.teamsReactionDelegation': false,
            'teamsReactionDelegation.dispatcherSkill': '',
        });
        expect(disabled.config.features.teamsReactionDelegation).toBe(false);
        expect(disabled.config.teamsReactionDelegation.dispatcherSkill).toBe('');
        const reloaded = new RuntimeConfigService({ configPath: config.configPath });
        expect(reloaded.config.teamsReactionDelegation).toEqual(disabled.config.teamsReactionDelegation);
    });
});
