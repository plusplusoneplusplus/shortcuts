/**
 * Unit tests for MessagingConfigService — Teams config persistence into
 * config.yaml with injectable fs, verifying merge semantics and missing-file
 * tolerance.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as jsYaml from 'js-yaml';
import { MessagingConfigService, type MessagingConfigFs } from '../../src/server/messaging-config';

const CONFIG_PATH = path.join('/data', 'config.yaml');

function memFs(initial: Record<string, string> = {}): MessagingConfigFs & { files: Record<string, string> } {
    const files: Record<string, string> = { ...initial };
    return {
        files,
        readFileSync: ((p: string) => {
            if (!(p in files)) {
                const err: any = new Error(`ENOENT: ${p}`);
                err.code = 'ENOENT';
                throw err;
            }
            return files[p];
        }) as any,
        writeFileSync: ((p: string, data: string) => { files[p] = data; }) as any,
    };
}

describe('MessagingConfigService', () => {
    it.each(['amer', 'emea', 'apac', null] as const)('persists region %s and preserves it on unrelated saves', ic3Region => {
        const fs = memFs();
        const service = new MessagingConfigService('/data', fs, jsYaml);
        service.saveTeamsConfig({ ic3Region });
        service.saveTeamsConfig({ botName: 'Bot' });
        expect((jsYaml.load(fs.files[CONFIG_PATH]) as any).messaging.teams).toEqual({ ic3Region, botName: 'Bot' });
    });

    it.each(['', 'auto', 'AMER', '../amer', 'https://example.test', 1])('rejects invalid region %j before persistence', ic3Region => {
        const fs = memFs();
        expect(() => new MessagingConfigService('/data', fs, jsYaml).saveTeamsConfig({ ic3Region } as any)).toThrow('IC3 region must be');
        expect(fs.files).toEqual({});
    });

    it('saveTeamsConfig writes only defined fields under messaging.teams', () => {
        const fs = memFs();
        new MessagingConfigService('/data', fs, jsYaml).saveTeamsConfig({ enabled: true, botName: 'Bot', mode: 'mcp' });
        const doc = jsYaml.load(fs.files[CONFIG_PATH]) as any;
        expect(doc.messaging.teams).toEqual({ enabled: true, botName: 'Bot', mode: 'mcp' });
    });

    it('merges into an existing config without clobbering other keys', () => {
        const fs = memFs({ [CONFIG_PATH]: jsYaml.dump({ serve: { port: 9 }, messaging: { teams: { botName: 'Old', channelId: 'c1' } } }) });
        new MessagingConfigService('/data', fs, jsYaml).saveTeamsConfig({ botName: 'New' });
        const doc = jsYaml.load(fs.files[CONFIG_PATH]) as any;
        expect(doc.serve).toEqual({ port: 9 });
        expect(doc.messaging.teams).toEqual({ botName: 'New', channelId: 'c1' });
    });

    it('enableTeams sets enabled + mcpServerUrl', () => {
        const fs = memFs();
        new MessagingConfigService('/data', fs, jsYaml).enableTeams('https://mcp');
        const doc = jsYaml.load(fs.files[CONFIG_PATH]) as any;
        expect(doc.messaging.teams).toEqual({ enabled: true, mcpServerUrl: 'https://mcp' });
    });

    it('tolerates a missing config file (starts from an empty doc)', () => {
        const fs = memFs();
        const svc = new MessagingConfigService('/data', fs, jsYaml);
        expect(() => svc.saveTeamsConfig({ enabled: false })).not.toThrow();
        expect(fs.files[CONFIG_PATH]).toBeDefined();
    });
});
