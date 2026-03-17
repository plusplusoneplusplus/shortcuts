/**
 * Tests for bundled-skills-provider logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getBundledSkills, installBundledSkills, getBundledSkillsPath } from '../../src/skills/bundled-skills-provider';

describe('getBundledSkillsPath', () => {
    it('returns a string path', () => {
        const p = getBundledSkillsPath();
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
    });
});

describe('getBundledSkills', () => {
    it('returns an array (even if bundled path does not exist in test env)', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-'));
        const skills = getBundledSkills(tmpDir);
        expect(Array.isArray(skills)).toBe(true);
        fs.rmdirSync(tmpDir);
    });

    it('marks skills as alreadyExists when they are installed', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-'));
        try {
            // Get skills without any installed
            const skillsBefore = getBundledSkills(tmpDir);

            if (skillsBefore.length > 0) {
                const first = skillsBefore[0];
                expect(first.alreadyExists).toBe(false);

                // "install" by creating a directory with SKILL.md
                const skillDir = path.join(tmpDir, first.name);
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\nDescription');

                const skillsAfter = getBundledSkills(tmpDir);
                const installed = skillsAfter.find(s => s.name === first.name);
                expect(installed?.alreadyExists).toBe(true);
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('installBundledSkills', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-bundled-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty result for empty skills array', async () => {
        const result = await installBundledSkills([], tmpDir, async () => false);
        expect(result.installed).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.details).toHaveLength(0);
    });

    it('skips skill when conflict handler returns false', async () => {
        // Create a fake existing skill
        const skillDir = path.join(tmpDir, 'my-skill');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Existing');

        const fakeSkills = [{
            name: 'my-skill',
            description: 'A fake skill',
            path: skillDir,
            alreadyExists: true,
        }];

        const result = await installBundledSkills(fakeSkills, tmpDir, async () => false);
        expect(result.skipped).toBe(1);
        expect(result.installed).toBe(0);
    });

    it('installs skill from a real source path', async () => {
        // Create a temporary source skill directory
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-skill-'));
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-skill-'));

        try {
            fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# My Skill\nA test skill');
            fs.writeFileSync(path.join(sourceDir, 'prompt.md'), 'Do things');

            const fakeSkills = [{
                name: 'my-skill',
                description: 'A test skill',
                path: sourceDir,
                alreadyExists: false,
            }];

            const result = await installBundledSkills(fakeSkills, installDir, async () => false);
            expect(result.installed).toBe(1);
            expect(result.failed).toBe(0);

            // Verify files were copied
            expect(fs.existsSync(path.join(installDir, 'my-skill', 'SKILL.md'))).toBe(true);
        } finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
            fs.rmSync(installDir, { recursive: true, force: true });
        }
    });
});
