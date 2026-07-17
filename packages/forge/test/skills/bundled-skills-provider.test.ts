/**
 * Tests for bundled-skills-provider logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as yaml from 'yaml';
import {
    getBundledSkills,
    installBundledSkills,
    getBundledSkillsPath,
    parseBundledSkillVersion,
    autoInstallDefaultSkills,
    getBundledSkillsRegistry,
} from '../../src/skills/bundled-skills-provider';
import type { BundledSkill } from '../../src/skills/types';

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

    it('does not bundle obsolete work-item skills (superseded by the create_update_work_item tool)', () => {
        // Regression guard: these skills were removed from the bundle in favor of
        // the unified create_update_work_item LLM tool. They must not reappear in the
        // registry or as resolved bundled-skill payloads.
        const removedSkills = ['create-work-item', 'create-bug', 'update-work-item'];
        const registryNames = getBundledSkillsRegistry().map(s => s.name);
        for (const removedSkill of removedSkills) {
            expect(registryNames).not.toContain(removedSkill);
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-'));
        try {
            const names = getBundledSkills(tmpDir).map(s => s.name);
            for (const removedSkill of removedSkills) {
                expect(names).not.toContain(removedSkill);
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }

        const bundledPath = getBundledSkillsPath();
        for (const removedSkill of removedSkills) {
            expect(fs.existsSync(path.join(bundledPath, removedSkill))).toBe(false);
        }
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

describe('BundledSkill version field', () => {
    it('every registry entry has a version in its SKILL.md', () => {
        // Verify bundled skill versions are accessible through parseBundledSkillVersion
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-check-'));
        try {
            const skills = getBundledSkills(tmpDir);
            expect(skills.length).toBeGreaterThan(0);

            for (const skill of skills) {
                const version = parseBundledSkillVersion(skill.name);
                expect(version, `${skill.name} should have a parseable version`).toBeDefined();
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('BundledSkill type does not have a version field', () => {
        const skill: BundledSkill = {
            name: 'test',
            description: 'A test skill',
            relativePath: 'test',
        };
        expect(skill.name).toBe('test');
        // version is no longer on BundledSkill — it comes from SKILL.md
    });
});

describe('SKILL.md metadata', () => {
    const bundledPath = getBundledSkillsPath();

    it('registers delegate and resolves its expected SKILL.md', () => {
        const entry = getBundledSkillsRegistry().find(skill => skill.name === 'delegate');
        expect(entry).toMatchObject({
            name: 'delegate',
            description: 'Delegate a job from the current chat to a new conversation. Use when the user asks to delegate or hand off work.',
            relativePath: 'delegate',
        });

        const skillFile = path.join(bundledPath, entry!.relativePath, 'SKILL.md');
        const content = fs.readFileSync(skillFile, 'utf-8').replace(/\r\n/g, '\n');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        expect(fmMatch, 'delegate/SKILL.md should have YAML frontmatter').toBeTruthy();

        const parsed = yaml.parse(fmMatch![1]);
        expect(parsed).toMatchObject({
            name: 'delegate',
            description: entry!.description,
            metadata: {
                author: 'Yiheng Tao',
                version: '0.0.1',
            },
        });
        expect(fmMatch![2].trim()).toBe('# Delegate\n\nBased on this conversation, delegate the requested job to a new conversation with the relevant context, constraints, and expected outcome.');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-resolve-'));
        try {
            const discovered = getBundledSkills(tmpDir).find(skill => skill.name === 'delegate');
            expect(discovered).toMatchObject({
                name: 'delegate',
                description: entry!.description,
                path: path.dirname(skillFile),
                alreadyExists: false,
            });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('every bundled SKILL.md has valid YAML frontmatter with metadata.version', () => {
        const skillDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        expect(skillDirs.length).toBeGreaterThanOrEqual(8);

        for (const dir of skillDirs) {
            const skillFile = path.join(bundledPath, dir, 'SKILL.md');
            if (!fs.existsSync(skillFile)) continue;

            const content = fs.readFileSync(skillFile, 'utf-8');
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            expect(fmMatch, `${dir}/SKILL.md should have YAML frontmatter`).toBeTruthy();

            const parsed = yaml.parse(fmMatch![1]);
            expect(parsed.name, `${dir}/SKILL.md name`).toBe(dir);
            expect(typeof parsed.description, `${dir}/SKILL.md description`).toBe('string');
            expect(parsed.metadata, `${dir}/SKILL.md should have metadata block`).toBeDefined();
            expect(parsed.metadata.version, `${dir}/SKILL.md should have metadata.version`).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });

    it('name and description fields are unchanged (not empty)', () => {
        const skillDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );

        for (const dir of skillDirs) {
            const skillFile = path.join(bundledPath, dir, 'SKILL.md');
            if (!fs.existsSync(skillFile)) continue;

            const content = fs.readFileSync(skillFile, 'utf-8');
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            const parsed = yaml.parse(fmMatch![1]);

            expect(parsed.name.length).toBeGreaterThan(0);
            expect(parsed.description.length).toBeGreaterThan(10);
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
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-skill-'));
        fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# Source');

        const skillDir = path.join(tmpDir, 'my-skill');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Existing');

        const fakeSkills = [{
            name: 'my-skill',
            description: 'A fake skill',
            path: sourceDir,
            alreadyExists: true,
        }];

        try {
            const result = await installBundledSkills(fakeSkills, tmpDir, async () => false);
            expect(result.skipped).toBe(1);
            expect(result.installed).toBe(0);
            expect(result.details[0]).toMatchObject({
                name: 'my-skill',
                success: true,
                action: 'skipped',
                reason: 'User declined to replace existing skill',
            });
            expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe('# Existing');
        } finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
        }
    });

    it('replaces an existing skill when conflict handler returns true', async () => {
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-skill-'));
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-skill-'));

        try {
            fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# Replaced');

            const targetDir = path.join(installDir, 'my-skill');
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '# Existing');
            fs.writeFileSync(path.join(targetDir, 'SENTINEL'), 'remove-me');

            const fakeSkills = [{
                name: 'my-skill',
                description: 'A test skill',
                path: sourceDir,
                alreadyExists: true,
            }];

            const result = await installBundledSkills(fakeSkills, installDir, async () => true);
            expect(result.installed).toBe(1);
            expect(result.skipped).toBe(0);
            expect(result.details[0]).toMatchObject({
                name: 'my-skill',
                success: true,
                action: 'replaced',
            });
            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8')).toBe('# Replaced');
            expect(fs.existsSync(path.join(targetDir, 'SENTINEL'))).toBe(false);
        } finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
            fs.rmSync(installDir, { recursive: true, force: true });
        }
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

describe('autoInstallDefaultSkills', () => {
    let installDir: string;

    beforeEach(() => {
        installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-install-'));
    });

    afterEach(() => {
        fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('returns empty result for empty skill names list', async () => {
        const result = await autoInstallDefaultSkills(installDir, []);
        expect(result.installed).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
    });

    it('silently skips unknown skill names (not an error)', async () => {
        const result = await autoInstallDefaultSkills(installDir, ['non-existent-skill-xyz']);
        expect(result.errors).toHaveLength(0);
        expect(result.skipped).toContain('non-existent-skill-xyz');
        expect(result.installed).toHaveLength(0);
    });

    it('installs a known bundled skill into a fresh directory', async () => {
        const skills = getBundledSkills(installDir);
        if (skills.length === 0) {
            // bundled skills not available in this test environment
            return;
        }
        const skillName = skills[0].name;
        const result = await autoInstallDefaultSkills(installDir, [skillName]);
        expect(result.errors).toHaveLength(0);
        // Either installed (if bundled path available) or skipped (test env without bundled files)
        const didInstall = result.installed.includes(skillName);
        const didSkip = result.skipped.includes(skillName);
        expect(didInstall || didSkip).toBe(true);
        if (didInstall) {
            expect(fs.existsSync(path.join(installDir, skillName, 'SKILL.md'))).toBe(true);
        }
    });

    it('installs delegate when missing and preserves an existing installed copy', async () => {
        const result = await autoInstallDefaultSkills(installDir, ['delegate']);
        expect(result.errors).toHaveLength(0);
        expect(result.installed).toContain('delegate');
        expect(result.skipped).not.toContain('delegate');

        const skillFile = path.join(installDir, 'delegate', 'SKILL.md');
        expect(fs.readFileSync(skillFile, 'utf-8')).toBe(
            fs.readFileSync(path.join(getBundledSkillsPath(), 'delegate', 'SKILL.md'), 'utf-8'),
        );

        fs.writeFileSync(path.join(installDir, 'delegate', 'SENTINEL'), 'keep-me');
        const secondResult = await autoInstallDefaultSkills(installDir, ['delegate']);
        expect(secondResult.errors).toHaveLength(0);
        expect(secondResult.installed).not.toContain('delegate');
        expect(secondResult.skipped).toContain('delegate');
        expect(fs.readFileSync(path.join(installDir, 'delegate', 'SENTINEL'), 'utf-8')).toBe('keep-me');
    });

    it('does not overwrite an already-installed skill without a parseable version', async () => {
        const skills = getBundledSkills(installDir);
        if (skills.length === 0) return;

        const skillName = skills[0].name;

        // Pre-install: create a stub with a sentinel file
        const existingDir = path.join(installDir, skillName);
        fs.mkdirSync(existingDir, { recursive: true });
        const sentinelPath = path.join(existingDir, 'SENTINEL');
        fs.writeFileSync(sentinelPath, 'original');

        const result = await autoInstallDefaultSkills(installDir, [skillName]);
        expect(result.errors).toHaveLength(0);
        expect(result.skipped).toContain(skillName);
        expect(result.installed).not.toContain(skillName);
        // sentinel file must be untouched
        expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('original');
    });

    it('installs only missing skills and skips up-to-date existing skills', async () => {
        const skills = getBundledSkills(installDir);
        if (skills.length < 2) return;

        const [first, second] = skills;

        copyDirSync(first.path, path.join(installDir, first.name));

        const result = await autoInstallDefaultSkills(installDir, [first.name, second.name]);
        expect(result.errors).toHaveLength(0);
        expect(result.skipped).toContain(first.name);
        // second should be installed (or skipped if bundled files missing in test env)
        const installed = result.installed.includes(second.name);
        const skipped = result.skipped.includes(second.name);
        expect(installed || skipped).toBe(true);
    });

    it('replaces an older installed default skill during version-check install', async () => {
        const skills = getBundledSkills(installDir);
        if (skills.length === 0) return;

        const skill = skills[0];
        const existingDir = path.join(installDir, skill.name);
        fs.mkdirSync(existingDir, { recursive: true });
        fs.writeFileSync(
            path.join(existingDir, 'SKILL.md'),
            `---\nname: ${skill.name}\ndescription: Old skill\nmetadata:\n  version: "0.0.0"\n---\n\n# Old Skill\n`,
            'utf-8',
        );
        fs.writeFileSync(path.join(existingDir, 'SENTINEL'), 'remove-me');

        const result = await autoInstallDefaultSkills(installDir, [skill.name]);
        expect(result.errors).toHaveLength(0);
        expect(result.installed).toContain(skill.name);
        expect(result.skipped).not.toContain(skill.name);
        expect(fs.existsSync(path.join(existingDir, 'SENTINEL'))).toBe(false);
        expect(fs.readFileSync(path.join(existingDir, 'SKILL.md'), 'utf-8')).toBe(
            fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf-8'),
        );
    });
});

function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const sourcePath = path.join(src, entry.name);
        const targetPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(sourcePath, targetPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}
