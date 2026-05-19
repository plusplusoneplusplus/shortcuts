/**
 * Tests for skill-updater (autoUpdateBundledSkills).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { autoUpdateBundledSkills } from '../../src/skills/skill-updater';
import { getBundledSkillsPath } from '../../src/skills/bundled-skills-provider';

/**
 * Helper: create a minimal installed skill with a given version in SKILL.md
 */
function createInstalledSkill(dir: string, name: string, version?: string): void {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });

    const versionBlock = version
        ? `metadata:\n  version: "${version}"`
        : '';
    const content = `---\nname: ${name}\ndescription: Test skill\n${versionBlock}\n---\n\n# ${name}\n`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
}

describe('autoUpdateBundledSkills', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-update-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('skips skills that are not installed', async () => {
        // Empty global dir — nothing installed
        const result = await autoUpdateBundledSkills(tmpDir);
        expect(result.updated).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
        // All registry skills should be skipped as not-installed
        for (const skip of result.skipped) {
            expect(skip.reason).toBe('not-installed');
        }
    });

    it('skips installed skills when versions match', async () => {
        // Install a real bundled skill with the same version as bundled
        const bundledPath = getBundledSkillsPath();
        const bundledDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        if (bundledDirs.length === 0) return; // skip in CI if no bundled skills

        const skillName = bundledDirs[0];
        // Copy the actual bundled skill to simulate an up-to-date install
        copyDirSync(path.join(bundledPath, skillName), path.join(tmpDir, skillName));

        const result = await autoUpdateBundledSkills(tmpDir);
        const entry = result.skipped.find(s => s.name === skillName);
        expect(entry, `${skillName} should be skipped`).toBeDefined();
        expect(entry!.reason).toBe('up-to-date');
        // Should not appear in updated
        expect(result.updated.find(u => u.name === skillName)).toBeUndefined();
    });

    it('updates installed skill when bundled version is newer', async () => {
        // Create an installed skill with an older version
        const bundledPath = getBundledSkillsPath();
        const bundledDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        if (bundledDirs.length === 0) return;

        const skillName = bundledDirs[0];
        // Install with version 0.0.0 (older than any bundled 0.0.1)
        createInstalledSkill(tmpDir, skillName, '0.0.0');

        const result = await autoUpdateBundledSkills(tmpDir);
        const updated = result.updated.find(u => u.name === skillName);
        expect(updated, `${skillName} should be updated`).toBeDefined();
        expect(updated!.previousVersion).toBe('0.0.0');
        expect(updated!.newVersion).toBeDefined();
    });

    it('skips installed skill when installed version is newer', async () => {
        const bundledPath = getBundledSkillsPath();
        const bundledDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        if (bundledDirs.length === 0) return;

        const skillName = bundledDirs[0];
        // Install with a very high version
        createInstalledSkill(tmpDir, skillName, '99.0.0');

        const result = await autoUpdateBundledSkills(tmpDir);
        const entry = result.skipped.find(s => s.name === skillName);
        expect(entry, `${skillName} should be skipped`).toBeDefined();
        expect(entry!.reason).toBe('installed-newer');
    });

    it('updates installed skill when installed SKILL.md has no version (treats as 0.0.0)', async () => {
        const bundledPath = getBundledSkillsPath();
        const bundledDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        if (bundledDirs.length === 0) return;

        const skillName = bundledDirs[0];
        createInstalledSkill(tmpDir, skillName); // no version

        const result = await autoUpdateBundledSkills(tmpDir);
        const updated = result.updated.find(u => u.name === skillName);
        expect(updated, `${skillName} should be updated despite missing installed version`).toBeDefined();
        expect(updated!.previousVersion).toBe('0.0.0');
        expect(updated!.newVersion).toMatch(/^\d+\.\d+\.\d+$/);

        // Verify the file was actually replaced with bundled content (which has frontmatter).
        const installedContent = fs.readFileSync(path.join(tmpDir, skillName, 'SKILL.md'), 'utf-8');
        expect(installedContent).toMatch(/^---/);
        expect(installedContent).toMatch(/version:/);
    });

    it('dry-run reports updates without changing files', async () => {
        const bundledPath = getBundledSkillsPath();
        const bundledDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        if (bundledDirs.length === 0) return;

        const skillName = bundledDirs[0];
        createInstalledSkill(tmpDir, skillName, '0.0.0');

        // Read the original SKILL.md to verify it's unchanged after dry-run
        const installedSkillMd = path.join(tmpDir, skillName, 'SKILL.md');
        const originalContent = fs.readFileSync(installedSkillMd, 'utf-8');

        const result = await autoUpdateBundledSkills(tmpDir, { dryRun: true });
        const updated = result.updated.find(u => u.name === skillName);
        expect(updated, `${skillName} should appear as would-be-updated`).toBeDefined();

        // File should be unchanged
        const afterContent = fs.readFileSync(installedSkillMd, 'utf-8');
        expect(afterContent).toBe(originalContent);
    });

    it('actually copies files when not dry-run', async () => {
        const bundledPath = getBundledSkillsPath();
        const bundledDirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );
        if (bundledDirs.length === 0) return;

        const skillName = bundledDirs[0];
        createInstalledSkill(tmpDir, skillName, '0.0.0');

        const result = await autoUpdateBundledSkills(tmpDir);
        const updated = result.updated.find(u => u.name === skillName);
        expect(updated).toBeDefined();

        // After update, the installed SKILL.md should match the bundled version
        const installedContent = fs.readFileSync(
            path.join(tmpDir, skillName, 'SKILL.md'), 'utf-8'
        );
        const bundledContent = fs.readFileSync(
            path.join(bundledPath, skillName, 'SKILL.md'), 'utf-8'
        );
        expect(installedContent).toBe(bundledContent);
    });
});

/** Simple recursive copy */
function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(s, d);
        else fs.copyFileSync(s, d);
    }
}
