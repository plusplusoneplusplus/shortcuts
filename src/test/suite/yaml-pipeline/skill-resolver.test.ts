/**
 * Tests for Skill Resolver
 *
 * Comprehensive tests for skill resolution from .github/skills/ directory.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolveSkill,
    resolveSkillSync,
    resolveSkillWithDetails,
    resolveSkillWithDetailsSync,
    skillExists,
    listSkills,
    validateSkill,
    getSkillsDirectory,
    getSkillDirectory,
    getSkillPromptPath,
    SkillResolverError,
    DEFAULT_SKILLS_DIRECTORY,
    SKILL_PROMPT_FILENAME,
    SKILL_METADATA_FILENAME
} from '../../../shortcuts/yaml-pipeline/skill-resolver';

suite('Skill Resolver', () => {
    let tempDir: string;
    let skillsDir: string;

    setup(async () => {
        // Create temp workspace with .github/skills structure
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
        skillsDir = path.join(tempDir, '.github', 'skills');
        await fs.promises.mkdir(skillsDir, { recursive: true });
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a skill
    async function createSkill(
        name: string,
        promptContent: string,
        metadataContent?: string
    ): Promise<string> {
        const skillDir = path.join(skillsDir, name);
        await fs.promises.mkdir(skillDir, { recursive: true });
        
        await fs.promises.writeFile(
            path.join(skillDir, SKILL_PROMPT_FILENAME),
            promptContent
        );
        
        if (metadataContent) {
            await fs.promises.writeFile(
                path.join(skillDir, SKILL_METADATA_FILENAME),
                metadataContent
            );
        }
        
        return skillDir;
    }

    suite('Constants', () => {
        test('DEFAULT_SKILLS_DIRECTORY is correct', () => {
            assert.strictEqual(DEFAULT_SKILLS_DIRECTORY, '.github/skills');
        });

        test('SKILL_PROMPT_FILENAME is correct', () => {
            assert.strictEqual(SKILL_PROMPT_FILENAME, 'prompt.md');
        });

        test('SKILL_METADATA_FILENAME is correct', () => {
            assert.strictEqual(SKILL_METADATA_FILENAME, 'SKILL.md');
        });
    });

    suite('Path Resolution', () => {
        test('getSkillsDirectory returns correct path', () => {
            const result = getSkillsDirectory(tempDir);
            assert.strictEqual(result, path.join(tempDir, '.github', 'skills'));
        });

        test('getSkillsDirectory with custom path (relative)', () => {
            const result = getSkillsDirectory(tempDir, 'custom/skills');
            assert.strictEqual(result, path.join(tempDir, 'custom', 'skills'));
        });

        test('getSkillsDirectory with custom path (absolute)', () => {
            const customPath = path.join(os.tmpdir(), 'custom-skills');
            const result = getSkillsDirectory(tempDir, customPath);
            assert.strictEqual(result, customPath);
        });

        test('getSkillDirectory returns correct path', () => {
            const result = getSkillDirectory('go-deep', tempDir);
            assert.strictEqual(result, path.join(tempDir, '.github', 'skills', 'go-deep'));
        });

        test('getSkillPromptPath returns correct path', () => {
            const result = getSkillPromptPath('go-deep', tempDir);
            assert.strictEqual(result, path.join(tempDir, '.github', 'skills', 'go-deep', 'prompt.md'));
        });
    });

    suite('skillExists', () => {
        test('returns true for existing skill', async () => {
            await createSkill('test-skill', 'Test prompt content');
            assert.strictEqual(skillExists('test-skill', tempDir), true);
        });

        test('returns false for non-existent skill', () => {
            assert.strictEqual(skillExists('non-existent', tempDir), false);
        });

        test('returns false for skill without prompt.md', async () => {
            // Create skill directory without prompt.md
            const skillDir = path.join(skillsDir, 'empty-skill');
            await fs.promises.mkdir(skillDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(skillDir, 'SKILL.md'),
                'Just metadata'
            );
            
            assert.strictEqual(skillExists('empty-skill', tempDir), false);
        });
    });

    suite('listSkills', () => {
        test('returns empty array when no skills exist', () => {
            const result = listSkills(tempDir);
            assert.deepStrictEqual(result, []);
        });

        test('returns empty array when skills directory does not exist', async () => {
            await fs.promises.rm(skillsDir, { recursive: true, force: true });
            const result = listSkills(tempDir);
            assert.deepStrictEqual(result, []);
        });

        test('lists all valid skills', async () => {
            await createSkill('alpha', 'Alpha prompt');
            await createSkill('beta', 'Beta prompt');
            await createSkill('gamma', 'Gamma prompt');
            
            const result = listSkills(tempDir);
            assert.deepStrictEqual(result, ['alpha', 'beta', 'gamma']);
        });

        test('excludes directories without prompt.md', async () => {
            await createSkill('valid-skill', 'Valid prompt');
            
            // Create invalid skill (no prompt.md)
            const invalidDir = path.join(skillsDir, 'invalid-skill');
            await fs.promises.mkdir(invalidDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(invalidDir, 'README.md'),
                'Not a prompt'
            );
            
            const result = listSkills(tempDir);
            assert.deepStrictEqual(result, ['valid-skill']);
        });

        test('excludes files (only directories)', async () => {
            await createSkill('valid-skill', 'Valid prompt');
            
            // Create a file in skills directory
            await fs.promises.writeFile(
                path.join(skillsDir, 'not-a-skill.txt'),
                'Just a file'
            );
            
            const result = listSkills(tempDir);
            assert.deepStrictEqual(result, ['valid-skill']);
        });
    });

    suite('resolveSkill (async)', () => {
        test('resolves skill prompt content', async () => {
            await createSkill('test-skill', 'Analyze {{topic}} deeply');
            
            const result = await resolveSkill('test-skill', tempDir);
            assert.strictEqual(result, 'Analyze {{topic}} deeply');
        });

        test('strips frontmatter from prompt', async () => {
            const promptWithFrontmatter = `---
version: 1.0
description: Test skill
---

Analyze {{topic}} deeply`;
            
            await createSkill('frontmatter-skill', promptWithFrontmatter);
            
            const result = await resolveSkill('frontmatter-skill', tempDir);
            assert.strictEqual(result, 'Analyze {{topic}} deeply');
        });

        test('throws SkillResolverError for non-existent skill', async () => {
            try {
                await resolveSkill('non-existent', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
                assert.strictEqual(error.skillName, 'non-existent');
                assert.ok(error.message.includes('not found'));
            }
        });

        test('throws SkillResolverError for empty skill name', async () => {
            try {
                await resolveSkill('', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
                assert.ok(error.message.includes('non-empty string'));
            }
        });

        test('throws SkillResolverError for skill name with path separators', async () => {
            try {
                await resolveSkill('../malicious', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
                assert.ok(error.message.includes('path separators'));
            }
        });

        test('throws SkillResolverError for skill with empty prompt', async () => {
            await createSkill('empty-prompt', '');
            
            try {
                await resolveSkill('empty-prompt', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
                assert.ok(error.message.includes('empty'));
            }
        });

        test('throws SkillResolverError for skill with only frontmatter', async () => {
            const onlyFrontmatter = `---
version: 1.0
---
`;
            await createSkill('only-frontmatter', onlyFrontmatter);
            
            try {
                await resolveSkill('only-frontmatter', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
                assert.ok(error.message.includes('empty'));
            }
        });
    });

    suite('resolveSkillSync', () => {
        test('resolves skill prompt content synchronously', async () => {
            await createSkill('sync-skill', 'Sync prompt content');
            
            const result = resolveSkillSync('sync-skill', tempDir);
            assert.strictEqual(result, 'Sync prompt content');
        });

        test('throws for non-existent skill', () => {
            try {
                resolveSkillSync('non-existent', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
            }
        });
    });

    suite('resolveSkillWithDetails', () => {
        test('returns full resolution details', async () => {
            await createSkill('detailed-skill', 'Detailed prompt');
            
            const result = await resolveSkillWithDetails('detailed-skill', tempDir);
            
            assert.strictEqual(result.content, 'Detailed prompt');
            assert.strictEqual(
                result.resolvedPath,
                path.join(skillsDir, 'detailed-skill', 'prompt.md')
            );
            assert.strictEqual(
                result.skillDirectory,
                path.join(skillsDir, 'detailed-skill')
            );
            assert.strictEqual(result.hadFrontmatter, false);
        });

        test('indicates when frontmatter was stripped', async () => {
            const promptWithFrontmatter = `---
version: 1.0
---

Content here`;
            
            await createSkill('frontmatter-detail', promptWithFrontmatter);
            
            const result = await resolveSkillWithDetails('frontmatter-detail', tempDir);
            assert.strictEqual(result.hadFrontmatter, true);
            assert.strictEqual(result.content, 'Content here');
        });

        test('includes metadata when SKILL.md exists', async () => {
            const metadata = `---
name: Test Skill
description: A test skill for testing
version: 1.0.0
variables: [topic, depth]
output: [findings, sources]
---

# Test Skill

This is a test skill.`;
            
            await createSkill('metadata-skill', 'Prompt content', metadata);
            
            const result = await resolveSkillWithDetails('metadata-skill', tempDir);
            
            assert.ok(result.metadata);
            assert.strictEqual(result.metadata.name, 'Test Skill');
            assert.strictEqual(result.metadata.description, 'A test skill for testing');
            assert.strictEqual(result.metadata.version, '1.0.0');
            assert.deepStrictEqual(result.metadata.variables, ['topic', 'depth']);
            assert.deepStrictEqual(result.metadata.output, ['findings', 'sources']);
        });

        test('metadata is undefined when SKILL.md does not exist', async () => {
            await createSkill('no-metadata', 'Just a prompt');
            
            const result = await resolveSkillWithDetails('no-metadata', tempDir);
            assert.strictEqual(result.metadata, undefined);
        });
    });

    suite('resolveSkillWithDetailsSync', () => {
        test('returns full resolution details synchronously', async () => {
            await createSkill('sync-detailed', 'Sync detailed prompt');
            
            const result = resolveSkillWithDetailsSync('sync-detailed', tempDir);
            
            assert.strictEqual(result.content, 'Sync detailed prompt');
            assert.ok(result.resolvedPath.endsWith('prompt.md'));
        });
    });

    suite('validateSkill', () => {
        test('returns valid for existing skill', async () => {
            await createSkill('valid-skill', 'Valid prompt');
            
            const result = validateSkill('valid-skill', tempDir);
            assert.strictEqual(result.valid, true);
            assert.ok(result.skillPath);
        });

        test('returns invalid for non-existent skill', () => {
            const result = validateSkill('non-existent', tempDir);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error);
            assert.ok(result.error.includes('not found'));
        });

        test('returns invalid for empty skill name', () => {
            const result = validateSkill('', tempDir);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error);
        });

        test('returns invalid for skill name with path traversal', () => {
            const result = validateSkill('../etc/passwd', tempDir);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error);
            assert.ok(result.error.includes('path separators'));
        });
    });

    suite('Cross-platform compatibility', () => {
        test('handles skill names with various characters', async () => {
            // Test skill names that are valid on all platforms
            const validNames = ['my-skill', 'my_skill', 'mySkill', 'skill123'];
            
            for (const name of validNames) {
                await createSkill(name, `Prompt for ${name}`);
                const result = await resolveSkill(name, tempDir);
                assert.strictEqual(result, `Prompt for ${name}`);
            }
        });

        test('rejects skill names with forward slashes', async () => {
            try {
                await resolveSkill('path/to/skill', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
            }
        });

        test('rejects skill names with backslashes', async () => {
            try {
                await resolveSkill('path\\to\\skill', tempDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof SkillResolverError);
            }
        });
    });

    suite('Custom skills directory', () => {
        test('resolves from custom skills directory', async () => {
            // Create custom skills directory
            const customSkillsDir = path.join(tempDir, 'custom', 'skills');
            await fs.promises.mkdir(customSkillsDir, { recursive: true });
            
            // Create skill in custom directory
            const skillDir = path.join(customSkillsDir, 'custom-skill');
            await fs.promises.mkdir(skillDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(skillDir, 'prompt.md'),
                'Custom skill prompt'
            );
            
            const result = await resolveSkill('custom-skill', tempDir, 'custom/skills');
            assert.strictEqual(result, 'Custom skill prompt');
        });

        test('lists skills from custom directory', async () => {
            const customSkillsDir = path.join(tempDir, 'my-skills');
            await fs.promises.mkdir(customSkillsDir, { recursive: true });
            
            // Create skills in custom directory
            for (const name of ['skill-a', 'skill-b']) {
                const skillDir = path.join(customSkillsDir, name);
                await fs.promises.mkdir(skillDir, { recursive: true });
                await fs.promises.writeFile(
                    path.join(skillDir, 'prompt.md'),
                    `Prompt for ${name}`
                );
            }
            
            const result = listSkills(tempDir, 'my-skills');
            assert.deepStrictEqual(result, ['skill-a', 'skill-b']);
        });
    });

    suite('Multiline prompts', () => {
        test('preserves multiline prompt content', async () => {
            const multilinePrompt = `You are an expert researcher.

Given the topic: {{topic}}

Please:
1. Research deeply
2. Find sources
3. Synthesize findings

Return your findings in JSON format.`;
            
            await createSkill('multiline-skill', multilinePrompt);
            
            const result = await resolveSkill('multiline-skill', tempDir);
            assert.strictEqual(result, multilinePrompt);
        });

        test('handles Windows line endings', async () => {
            const windowsPrompt = 'Line 1\r\nLine 2\r\nLine 3';
            await createSkill('windows-skill', windowsPrompt);
            
            const result = await resolveSkill('windows-skill', tempDir);
            // Content should be preserved (trimmed)
            assert.ok(result.includes('Line 1'));
            assert.ok(result.includes('Line 2'));
            assert.ok(result.includes('Line 3'));
        });
    });

    suite('Template variables in skills', () => {
        test('preserves template variables', async () => {
            const templatePrompt = `Analyze {{topic}} with depth {{depth}}.

Focus on: {{focus_areas}}

Return JSON with: {{output_fields}}`;
            
            await createSkill('template-skill', templatePrompt);
            
            const result = await resolveSkill('template-skill', tempDir);
            assert.ok(result.includes('{{topic}}'));
            assert.ok(result.includes('{{depth}}'));
            assert.ok(result.includes('{{focus_areas}}'));
            assert.ok(result.includes('{{output_fields}}'));
        });
    });
});
