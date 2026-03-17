/**
 * Tests for skill file discovery.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findSkills } from '../../src/discovery';

describe('findSkills', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-files-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    async function createSkill(name: string, skillMdContent = '# Skill'): Promise<void> {
        const skillDir = path.join(tempDir, '.github', 'skills', name);
        await fs.promises.mkdir(skillDir, { recursive: true });
        await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent);
    }

    it('returns empty for non-existent rootDir', async () => {
        const result = await findSkills('/no/such/path');
        expect(result).toEqual([]);
    });

    it('returns empty when skills directory missing', async () => {
        const result = await findSkills(tempDir);
        expect(result).toEqual([]);
    });

    it('discovers single skill', async () => {
        await createSkill('my-skill');

        const result = await findSkills(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('my-skill');
        expect(result[0].relativePath).toBe(path.join('.github', 'skills', 'my-skill'));
        expect(result[0].absolutePath).toBe(path.join(tempDir, '.github', 'skills', 'my-skill'));
        expect(result[0].sourceFolder).toBe('.github/skills');
    });

    it('excludes directories without SKILL.md', async () => {
        await createSkill('valid-skill');
        const emptyDir = path.join(tempDir, '.github', 'skills', 'empty-dir');
        await fs.promises.mkdir(emptyDir, { recursive: true });

        const result = await findSkills(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('valid-skill');
    });

    it('excludes files (not directories) in skills dir', async () => {
        await createSkill('valid-skill');
        const skillsDir = path.join(tempDir, '.github', 'skills');
        await fs.promises.writeFile(path.join(skillsDir, 'README.md'), '# README');

        const result = await findSkills(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('valid-skill');
    });

    it('parses description from YAML frontmatter', async () => {
        await createSkill('cool-skill', '---\ndescription: A cool skill\n---\n# Content');

        const result = await findSkills(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].description).toBe('A cool skill');
    });

    it('description is undefined without frontmatter', async () => {
        await createSkill('plain-skill', '# My Skill\nDo stuff');

        const result = await findSkills(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].description).toBeUndefined();
    });

    it('handles quoted description', async () => {
        await createSkill('quoted-skill', '---\ndescription: "Quoted desc"\n---\n# Content');

        const result = await findSkills(tempDir);

        expect(result[0].description).toBe('Quoted desc');
    });

    it('handles single-quoted description', async () => {
        await createSkill('sq-skill', "---\ndescription: 'Single quoted'\n---\n# Content");

        const result = await findSkills(tempDir);

        expect(result[0].description).toBe('Single quoted');
    });

    it('returns results sorted by name', async () => {
        await createSkill('z-skill');
        await createSkill('a-skill');
        await createSkill('m-skill');

        const result = await findSkills(tempDir);

        expect(result).toHaveLength(3);
        expect(result.map(s => s.name)).toEqual(['a-skill', 'm-skill', 'z-skill']);
    });

    it('resolves custom skillsLocation (relative)', async () => {
        const customDir = path.join(tempDir, 'custom', 'skills', 'my-skill');
        await fs.promises.mkdir(customDir, { recursive: true });
        await fs.promises.writeFile(path.join(customDir, 'SKILL.md'), '# Skill');

        const result = await findSkills(tempDir, 'custom/skills');

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('my-skill');
        expect(result[0].sourceFolder).toBe('custom/skills');
    });

    it('resolves custom skillsLocation (absolute)', async () => {
        const absSkillsDir = path.join(tempDir, 'abs-skills');
        const skillDir = path.join(absSkillsDir, 'my-skill');
        await fs.promises.mkdir(skillDir, { recursive: true });
        await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), '# Skill');

        const result = await findSkills(tempDir, absSkillsDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('my-skill');
        expect(result[0].sourceFolder).toBe(absSkillsDir);
    });

    it('handles unreadable directory gracefully', async () => {
        // Skip on Windows — chmod doesn't restrict reads the same way
        if (process.platform === 'win32') {
            return;
        }

        const skillsDir = path.join(tempDir, '.github', 'skills');
        await fs.promises.mkdir(skillsDir, { recursive: true });
        await fs.promises.chmod(skillsDir, 0o000);

        const result = await findSkills(tempDir);
        expect(result).toEqual([]);

        // Restore permissions for cleanup
        await fs.promises.chmod(skillsDir, 0o755);
    });
});
