import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    autoInstallDefaultSkills,
    getBundledSkillsPath,
    getBundledSkillsRegistry,
    parseBundledSkillVersion,
} from '@plusplusoneplusplus/forge';
import { DEFAULT_BUNDLED_SKILLS, DEFAULT_CONFIG } from '../../src/config';
import { getDefaultSkillsToInstall } from '../../src/server/skills/default-skill-selection';

describe('bundled propose-diff skill', () => {
    const skillPath = path.join(getBundledSkillsPath(), 'propose-diff', 'SKILL.md');

    it('registers a bundled skill with matching metadata and a version', () => {
        const entry = getBundledSkillsRegistry().find(skill => skill.name === 'propose-diff');
        expect(entry?.relativePath).toBe('propose-diff');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/^---\r?\nname: propose-diff\r?\n/);
        expect(content).toContain(`description: ${entry?.description}`);
        expect(parseBundledSkillVersion('propose-diff')).toBe('0.0.1');
    });

    it('installs by default without requiring cron or canvas features', () => {
        expect(DEFAULT_BUNDLED_SKILLS).toContain('propose-diff');
        expect(getDefaultSkillsToInstall(DEFAULT_CONFIG.skills.defaultSkills, {
            cronEnabled: false,
            canvasEnabled: false,
        })).toContain('propose-diff');
    });

    it('requires a read-only diff proposal and explicit approval to apply it', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('minimal unified diff');
        expect(content).toContain('fenced `diff` block');
        expect(content).toContain('repository-relative file paths');
        expect(content).toContain('Do not modify files, apply patches, or commit.');
        expect(content).toContain('Use read-only tools and commands;');
        expect(content).toContain('do not delegate implementation or run commands that write files.');
        expect(content).toContain("Wait for the user's explicit approval before making changes.");
        expect(content).toContain('the proposal are not approval to apply it.');
    });

    it('copies the bundled skill on startup and preserves an up-to-date installation', async () => {
        const installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-diff-'));
        try {
            const defaults = getDefaultSkillsToInstall(DEFAULT_CONFIG.skills.defaultSkills, {
                cronEnabled: false,
                canvasEnabled: false,
            });
            const result = await autoInstallDefaultSkills(installPath, defaults);
            expect(result.errors).toEqual([]);
            expect(result.installed).toContain('propose-diff');
            const installedPath = path.join(installPath, 'propose-diff', 'SKILL.md');
            expect(fs.readFileSync(installedPath, 'utf-8')).toBe(fs.readFileSync(skillPath, 'utf-8'));
            const repeated = await autoInstallDefaultSkills(installPath, ['propose-diff']);
            expect(repeated).toEqual({ installed: [], skipped: ['propose-diff'], errors: [] });
        } finally {
            fs.rmSync(installPath, { recursive: true, force: true });
        }
    });
});
