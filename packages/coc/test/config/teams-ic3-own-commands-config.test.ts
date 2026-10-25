import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config';
import { CLIConfigSchema } from '../../src/config/schema';

describe('IC3 own-command settings', () => {
    it('defaults off without an implicit workspace or separate region', () => {
        expect(DEFAULT_CONFIG.features.teamsIc3OwnCommands).toBe(false);
        expect(DEFAULT_CONFIG.teamsIc3OwnCommands).toEqual({ workspaceId: '' });
    });

    it('merges target leaves without enabling the feature', () => {
        const config = mergeConfig(DEFAULT_CONFIG, {
            teamsIc3OwnCommands: { workspaceId: 'workspace-alpha' },
        });
        expect(mergeConfig(config, { teamsIc3OwnCommands: { workspaceId: 'workspace-beta' } }).teamsIc3OwnCommands)
            .toEqual({ workspaceId: 'workspace-beta' });
        expect(config.features.teamsIc3OwnCommands).toBe(false);
    });

    it.each([{ workspaceId: '../invalid' }, { region: 'amer' }, { token: 'not-supported' }, { enableTrouter: false }])(
        'rejects malformed or unsupported configuration: %j', teamsIc3OwnCommands => {
            expect(CLIConfigSchema.safeParse({ teamsIc3OwnCommands }).success).toBe(false);
        },
    );
});
