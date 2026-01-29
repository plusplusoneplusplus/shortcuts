import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getSkills, getSkillPaths, getSkillNames } from '../../shortcuts/shared/skill-files-utils';

suite('Skill Files Utils Tests', () => {
    let tempDir: string;

    setup(() => {
        // Create a temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('getSkills returns empty array when .github/skills does not exist', async () => {
        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 0);
    });

    test('getSkills returns empty array when .github/skills is empty', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 0);
    });

    test('getSkills finds skill directory', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'test-skill');
        fs.mkdirSync(skillDir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 1);
        assert.strictEqual(skills[0].name, 'test-skill');
        assert.strictEqual(skills[0].sourceFolder, '.github/skills');
        assert.strictEqual(skills[0].absolutePath, skillDir);
    });

    test('getSkills finds multiple skills', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        
        // Create skill 1
        const skill1Dir = path.join(skillsDir, 'skill-one');
        fs.mkdirSync(skill1Dir, { recursive: true });

        // Create skill 2
        const skill2Dir = path.join(skillsDir, 'skill-two');
        fs.mkdirSync(skill2Dir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 2);

        const names = skills.map(s => s.name).sort();
        assert.deepStrictEqual(names, ['skill-one', 'skill-two']);
    });

    test('getSkills ignores files in .github/skills root', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        
        // Create a file directly in skills folder (should be ignored)
        fs.writeFileSync(path.join(skillsDir, 'readme.md'), '# README');

        // Create valid skill directory
        const skillDir = path.join(skillsDir, 'valid-skill');
        fs.mkdirSync(skillDir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 1);
        assert.strictEqual(skills[0].name, 'valid-skill');
    });

    test('getSkills finds empty skill directories', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'empty-skill');
        fs.mkdirSync(skillDir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 1);
        assert.strictEqual(skills[0].name, 'empty-skill');
    });

    test('getSkills finds skill directories with any content', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'complex-skill');
        fs.mkdirSync(skillDir, { recursive: true });
        
        // Create various files in the skill directory
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill Prompt');
        fs.writeFileSync(path.join(skillDir, 'readme.md'), '# README');
        fs.writeFileSync(path.join(skillDir, 'config.yaml'), 'key: value');

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 1);
        assert.strictEqual(skills[0].name, 'complex-skill');
    });

    test('getSkillPaths returns array of absolute paths', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        
        const skill1Dir = path.join(skillsDir, 'skill-one');
        fs.mkdirSync(skill1Dir, { recursive: true });

        const skill2Dir = path.join(skillsDir, 'skill-two');
        fs.mkdirSync(skill2Dir, { recursive: true });

        const paths = await getSkillPaths(tempDir);
        assert.strictEqual(paths.length, 2);
        
        paths.forEach(p => {
            assert.ok(path.isAbsolute(p));
        });
    });

    test('getSkillNames returns array of skill names', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        
        const skill1Dir = path.join(skillsDir, 'skill-alpha');
        fs.mkdirSync(skill1Dir, { recursive: true });

        const skill2Dir = path.join(skillsDir, 'skill-beta');
        fs.mkdirSync(skill2Dir, { recursive: true });

        const names = await getSkillNames(tempDir);
        assert.strictEqual(names.length, 2);
        assert.ok(names.includes('skill-alpha'));
        assert.ok(names.includes('skill-beta'));
    });

    test('getSkills returns correct relative paths', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'test-skill');
        fs.mkdirSync(skillDir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 1);
        
        // Normalize path separators for cross-platform compatibility
        const normalizedPath = skills[0].relativePath.replace(/\\/g, '/');
        assert.strictEqual(normalizedPath, '.github/skills/test-skill');
    });

    test('getSkills handles cross-platform paths correctly', async () => {
        const skillsDir = path.join(tempDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'cross-platform-skill');
        fs.mkdirSync(skillDir, { recursive: true });

        const skills = await getSkills(tempDir);
        assert.strictEqual(skills.length, 1);
        
        // Ensure paths use the correct separator for the current platform
        assert.ok(skills[0].absolutePath.includes(path.sep));
        assert.ok(path.isAbsolute(skills[0].absolutePath));
    });

    test('getSkills returns empty array when workspaceRoot is undefined and no workspace is open', async () => {
        // Pass undefined to simulate no workspace
        const skills = await getSkills(undefined);
        assert.strictEqual(skills.length, 0);
    });
});
