/**
 * Tests for skills CLI command handlers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    executeSkillList,
    executeSkillInstallBundled,
    executeSkillDelete,
    executeSkillInstall,
} from '../../src/commands/skills';

describe('executeSkillList', () => {
    let workspaceDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-list-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('returns 0 and logs message when no skills installed', async () => {
        const code = await executeSkillList({ workspace: workspaceDir });
        expect(code).toBe(0);
        const allLoggedText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
        expect(allLoggedText).toContain('No skills installed');
    });

    it('returns 0 and lists skills when skills are installed', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const skillDir = path.join(skillsDir, 'my-skill');
        fs.mkdirSync(skillDir);
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\nA great skill');

        const code = await executeSkillList({ workspace: workspaceDir });
        expect(code).toBe(0);
        const loggedText = consoleSpy.mock.calls.flat().join('\n');
        expect(loggedText).toContain('my-skill');
    });

    it('uses cwd when no workspace option provided', async () => {
        const code = await executeSkillList({});
        expect(code).toBe(0); // cwd may have skills or not, but should not throw
    });
});

describe('executeSkillDelete', () => {
    let workspaceDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-delete-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('returns 1 when skill does not exist', async () => {
        const code = await executeSkillDelete('nonexistent', { workspace: workspaceDir });
        expect(code).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    });

    it('returns 0 and deletes skill when it exists', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const skillDir = path.join(skillsDir, 'my-skill');
        fs.mkdirSync(skillDir);
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');

        const code = await executeSkillDelete('my-skill', { workspace: workspaceDir });
        expect(code).toBe(0);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('my-skill'));
        expect(fs.existsSync(skillDir)).toBe(false);
    });

    it('returns 1 for path traversal attempt', async () => {
        const code = await executeSkillDelete('../../../etc/passwd', { workspace: workspaceDir });
        expect(code).toBe(1);
        const allErrorText = errorSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
        expect(allErrorText).toContain('Invalid skill name');
    });
});

describe('executeSkillInstallBundled', () => {
    let workspaceDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-bundled-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('returns 0 or 1 depending on bundled skills availability', async () => {
        const code = await executeSkillInstallBundled([], { workspace: workspaceDir });
        expect([0, 1]).toContain(code);
    });

    it('returns 1 when specified bundled skill names do not match any bundled skill', async () => {
        // This will either find no matching skills or find no bundled skills at all
        const code = await executeSkillInstallBundled(['nonexistent-skill-xyz'], { workspace: workspaceDir });
        expect(code).toBe(1);
    });
});

describe('executeSkillInstall', () => {
    let workspaceDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('returns 1 for invalid GitHub URL', async () => {
        const code = await executeSkillInstall('https://github.com/x', { workspace: workspaceDir });
        expect(code).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('returns 1 for completely invalid URL', async () => {
        const code = await executeSkillInstall('not-a-url', { workspace: workspaceDir });
        expect(code).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('installs from a local path', async () => {
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-src-'));
        try {
            const skillDir = path.join(sourceDir, 'test-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\nA test skill');

            const code = await executeSkillInstall(sourceDir, { workspace: workspaceDir });
            expect(code).toBe(0);

            // Verify the skill was installed
            const installedPath = path.join(workspaceDir, '.github', 'skills', 'test-skill', 'SKILL.md');
            expect(fs.existsSync(installedPath)).toBe(true);
        } finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
        }
    });
});

// ============================================================================
// Global skills (--global flag)
// ============================================================================

describe('executeSkillList --global', () => {
    let globalDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let origDataDir: string | undefined;

    beforeEach(() => {
        globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-list-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        origDataDir = process.env.COC_DATA_DIR;
        process.env.COC_DATA_DIR = globalDir;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(globalDir, { recursive: true, force: true });
        if (origDataDir !== undefined) process.env.COC_DATA_DIR = origDataDir;
        else delete process.env.COC_DATA_DIR;
    });

    it('returns 0 with no global skills message', async () => {
        const code = await executeSkillList({ global: true });
        expect(code).toBe(0);
        const allText = consoleSpy.mock.calls.flat().join('\n');
        expect(allText).toContain('No global skills installed');
    });

    it('lists global skills when installed', async () => {
        const skillsDir = path.join(globalDir, 'skills', 'my-global');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), '# My Global\nGlobal skill description');

        const code = await executeSkillList({ global: true });
        expect(code).toBe(0);
        const allText = consoleSpy.mock.calls.flat().join('\n');
        expect(allText).toContain('my-global');
    });
});

describe('executeSkillList --all', () => {
    let globalDir: string;
    let workspaceDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let origDataDir: string | undefined;

    beforeEach(() => {
        globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-all-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-all-ws-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        origDataDir = process.env.COC_DATA_DIR;
        process.env.COC_DATA_DIR = globalDir;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(globalDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        if (origDataDir !== undefined) process.env.COC_DATA_DIR = origDataDir;
        else delete process.env.COC_DATA_DIR;
    });

    it('shows both global and repo skills', async () => {
        // Create global skill
        const globalSkillDir = path.join(globalDir, 'skills', 'global-skill');
        fs.mkdirSync(globalSkillDir, { recursive: true });
        fs.writeFileSync(path.join(globalSkillDir, 'SKILL.md'), '# Global\nGlobal desc');

        // Create repo skill
        const repoSkillDir = path.join(workspaceDir, '.github', 'skills', 'repo-skill');
        fs.mkdirSync(repoSkillDir, { recursive: true });
        fs.writeFileSync(path.join(repoSkillDir, 'SKILL.md'), '# Repo\nRepo desc');

        const code = await executeSkillList({ all: true, workspace: workspaceDir });
        expect(code).toBe(0);
        const allText = consoleSpy.mock.calls.flat().join('\n');
        expect(allText).toContain('global-skill');
        expect(allText).toContain('repo-skill');
        expect(allText).toContain('global');
        expect(allText).toContain('repo');
    });
});

describe('executeSkillDelete --global', () => {
    let globalDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let origDataDir: string | undefined;

    beforeEach(() => {
        globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-del-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        origDataDir = process.env.COC_DATA_DIR;
        process.env.COC_DATA_DIR = globalDir;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(globalDir, { recursive: true, force: true });
        if (origDataDir !== undefined) process.env.COC_DATA_DIR = origDataDir;
        else delete process.env.COC_DATA_DIR;
    });

    it('deletes a global skill', async () => {
        const skillDir = path.join(globalDir, 'skills', 'to-delete');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# To Delete\nTest');

        const code = await executeSkillDelete('to-delete', { global: true });
        expect(code).toBe(0);
        expect(fs.existsSync(skillDir)).toBe(false);
    });

    it('returns 1 when global skill does not exist', async () => {
        fs.mkdirSync(path.join(globalDir, 'skills'), { recursive: true });
        const code = await executeSkillDelete('nonexistent', { global: true });
        expect(code).toBe(1);
    });
});

describe('executeSkillInstallBundled --global', () => {
    let globalDir: string;
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let origDataDir: string | undefined;

    beforeEach(() => {
        globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-bundled-'));
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        origDataDir = process.env.COC_DATA_DIR;
        process.env.COC_DATA_DIR = globalDir;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(globalDir, { recursive: true, force: true });
        if (origDataDir !== undefined) process.env.COC_DATA_DIR = origDataDir;
        else delete process.env.COC_DATA_DIR;
    });

    it('creates global skills directory and installs', async () => {
        const code = await executeSkillInstallBundled([], { global: true });
        // 0 if bundled skills exist, 1 if not — both are valid
        expect([0, 1]).toContain(code);
        // Global dir should have been created
        expect(fs.existsSync(path.join(globalDir, 'skills'))).toBe(true);
    });
});
