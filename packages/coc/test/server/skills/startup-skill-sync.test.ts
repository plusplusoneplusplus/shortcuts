import { describe, expect, it, vi } from 'vitest';
import { synchronizeBundledSkillsAtStartup } from '../../../src/server/skills/startup-skill-sync';

describe('startup bundled skill synchronization', () => {
    it('waits for default installation before provider mirrors', async () => {
        const events: string[] = [];
        let finishInstall: (() => void) | undefined;
        const installGate = new Promise<void>(resolve => {
            finishInstall = resolve;
        });
        const installDefaults = vi.fn(async () => {
            events.push('install-start');
            await installGate;
            events.push('install-finish');
            return { installed: ['long-running-reliability'], skipped: [], errors: [] };
        });
        const mirrorCodex = vi.fn(async () => {
            events.push('codex');
            return { synced: ['long-running-reliability'], errors: [] };
        });
        const mirrorClaude = vi.fn(async () => {
            events.push('claude');
            return { synced: ['long-running-reliability'], errors: [] };
        });

        const synchronization = synchronizeBundledSkillsAtStartup({
            globalSkillsDir: '/skills',
            defaultSkills: ['long-running-reliability'],
            autoUpdate: false,
            codexEnabled: true,
            claudeEnabled: true,
        }, {
            installDefaults,
            mirrorCodex,
            mirrorClaude,
            log: () => undefined,
        });
        await vi.waitFor(() => expect(events).toEqual(['install-start']));

        finishInstall!();
        await synchronization;

        expect(events[0]).toBe('install-start');
        expect(events[1]).toBe('install-finish');
        expect(new Set(events.slice(2))).toEqual(new Set(['codex', 'claude']));
    });
});
