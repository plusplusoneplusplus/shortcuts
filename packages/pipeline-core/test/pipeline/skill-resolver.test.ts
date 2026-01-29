/**
 * Tests for Skill Resolver
 *
 * Comprehensive tests for skill resolution from .github/skills/ directory.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    SKILL_PROMPT_FILENAME
} from '../../src/pipeline';

describe('Skill Resolver', () => {
    let tempDir: string;
    let skillsDir: string;

    beforeEach(async () => {
        // Create temp workspace with .github/skills structure
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
        skillsDir = path.join(tempDir, '.github', 'skills');
        await fs.promises.mkdir(skillsDir, { recursive: true });
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a skill
    // promptContent: The content of SKILL.md (can include frontmatter for metadata)
    async function createSkill(
        name: string,
        promptContent: string
    ): Promise<string> {
        const skillDir = path.join(skillsDir, name);
        await fs.promises.mkdir(skillDir, { recursive: true });
        
        await fs.promises.writeFile(
            path.join(skillDir, SKILL_PROMPT_FILENAME),
            promptContent
        );
        
        return skillDir;
    }

    describe('Constants', () => {
        it('DEFAULT_SKILLS_DIRECTORY is correct', () => {
            expect(DEFAULT_SKILLS_DIRECTORY).toBe('.github/skills');
        });

        it('SKILL_PROMPT_FILENAME is correct', () => {
            expect(SKILL_PROMPT_FILENAME).toBe('SKILL.md');
        });
    });

    describe('Path Resolution', () => {
        it('getSkillsDirectory returns correct path', () => {
            const result = getSkillsDirectory(tempDir);
            expect(result).toBe(path.join(tempDir, '.github', 'skills'));
        });

        it('getSkillsDirectory with custom path (relative)', () => {
            const result = getSkillsDirectory(tempDir, 'custom/skills');
            expect(result).toBe(path.join(tempDir, 'custom', 'skills'));
        });

        it('getSkillsDirectory with custom path (absolute)', () => {
            const customPath = path.join(os.tmpdir(), 'custom-skills');
            const result = getSkillsDirectory(tempDir, customPath);
            expect(result).toBe(customPath);
        });

        it('getSkillDirectory returns correct path', () => {
            const result = getSkillDirectory('go-deep', tempDir);
            expect(result).toBe(path.join(tempDir, '.github', 'skills', 'go-deep'));
        });

        it('getSkillPromptPath returns correct path', () => {
            const result = getSkillPromptPath('go-deep', tempDir);
            expect(result).toBe(path.join(tempDir, '.github', 'skills', 'go-deep', 'SKILL.md'));
        });
    });

    describe('skillExists', () => {
        it('returns true for existing skill', async () => {
            await createSkill('test-skill', 'Test prompt content');
            expect(skillExists('test-skill', tempDir)).toBe(true);
        });

        it('returns false for non-existent skill', () => {
            expect(skillExists('non-existent', tempDir)).toBe(false);
        });

        it('returns false for skill without SKILL.md', async () => {
            // Create skill directory without SKILL.md
            const skillDir = path.join(skillsDir, 'empty-skill');
            await fs.promises.mkdir(skillDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(skillDir, 'README.md'),
                'Just readme'
            );
            
            expect(skillExists('empty-skill', tempDir)).toBe(false);
        });
    });

    describe('listSkills', () => {
        it('returns empty array when no skills exist', () => {
            const result = listSkills(tempDir);
            expect(result).toEqual([]);
        });

        it('returns empty array when skills directory does not exist', async () => {
            await fs.promises.rm(skillsDir, { recursive: true, force: true });
            const result = listSkills(tempDir);
            expect(result).toEqual([]);
        });

        it('lists all valid skills', async () => {
            await createSkill('alpha', 'Alpha prompt');
            await createSkill('beta', 'Beta prompt');
            await createSkill('gamma', 'Gamma prompt');
            
            const result = listSkills(tempDir);
            expect(result).toEqual(['alpha', 'beta', 'gamma']);
        });

        it('excludes directories without SKILL.md', async () => {
            await createSkill('valid-skill', 'Valid prompt');
            
            // Create invalid skill (no SKILL.md)
            const invalidDir = path.join(skillsDir, 'invalid-skill');
            await fs.promises.mkdir(invalidDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(invalidDir, 'README.md'),
                'Not a prompt'
            );
            
            const result = listSkills(tempDir);
            expect(result).toEqual(['valid-skill']);
        });

        it('excludes files (only directories)', async () => {
            await createSkill('valid-skill', 'Valid prompt');
            
            // Create a file in skills directory
            await fs.promises.writeFile(
                path.join(skillsDir, 'not-a-skill.txt'),
                'Just a file'
            );
            
            const result = listSkills(tempDir);
            expect(result).toEqual(['valid-skill']);
        });
    });

    describe('resolveSkill (async)', () => {
        it('resolves skill prompt content', async () => {
            await createSkill('test-skill', 'Analyze {{topic}} deeply');
            
            const result = await resolveSkill('test-skill', tempDir);
            expect(result).toBe('Analyze {{topic}} deeply');
        });

        it('strips frontmatter from prompt', async () => {
            const promptWithFrontmatter = `---
version: 1.0
description: Test skill
---

Analyze {{topic}} deeply`;
            
            await createSkill('frontmatter-skill', promptWithFrontmatter);
            
            const result = await resolveSkill('frontmatter-skill', tempDir);
            expect(result).toBe('Analyze {{topic}} deeply');
        });

        it('throws SkillResolverError for non-existent skill', async () => {
            try {
                await resolveSkill('non-existent', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
                expect((error as SkillResolverError).skillName).toBe('non-existent');
                expect((error as Error).message).toContain('not found');
            }
        });

        it('throws SkillResolverError for empty skill name', async () => {
            try {
                await resolveSkill('', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
                expect((error as Error).message).toContain('non-empty string');
            }
        });

        it('throws SkillResolverError for skill name with path separators', async () => {
            try {
                await resolveSkill('../malicious', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
                expect((error as Error).message).toContain('path separators');
            }
        });

        it('throws SkillResolverError for skill with empty prompt', async () => {
            await createSkill('empty-prompt', '');
            
            try {
                await resolveSkill('empty-prompt', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
                expect((error as Error).message).toContain('empty');
            }
        });

        it('throws SkillResolverError for skill with only frontmatter', async () => {
            const onlyFrontmatter = `---
version: 1.0
---
`;
            await createSkill('only-frontmatter', onlyFrontmatter);
            
            try {
                await resolveSkill('only-frontmatter', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
                expect((error as Error).message).toContain('empty');
            }
        });
    });

    describe('resolveSkillSync', () => {
        it('resolves skill prompt content synchronously', async () => {
            await createSkill('sync-skill', 'Sync prompt content');
            
            const result = resolveSkillSync('sync-skill', tempDir);
            expect(result).toBe('Sync prompt content');
        });

        it('throws for non-existent skill', () => {
            try {
                resolveSkillSync('non-existent', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
            }
        });
    });

    describe('resolveSkillWithDetails', () => {
        it('returns full resolution details', async () => {
            await createSkill('detailed-skill', 'Detailed prompt');
            
            const result = await resolveSkillWithDetails('detailed-skill', tempDir);
            
            expect(result.content).toBe('Detailed prompt');
            expect(result.resolvedPath).toBe(
                path.join(skillsDir, 'detailed-skill', 'SKILL.md')
            );
            expect(result.skillDirectory).toBe(
                path.join(skillsDir, 'detailed-skill')
            );
            expect(result.hadFrontmatter).toBe(false);
        });

        it('indicates when frontmatter was stripped', async () => {
            const promptWithFrontmatter = `---
version: 1.0
---

Content here`;
            
            await createSkill('frontmatter-detail', promptWithFrontmatter);
            
            const result = await resolveSkillWithDetails('frontmatter-detail', tempDir);
            expect(result.hadFrontmatter).toBe(true);
            expect(result.content).toBe('Content here');
        });

        it('includes metadata from SKILL.md frontmatter', async () => {
            // SKILL.md contains both the prompt content and metadata in frontmatter
            const skillContent = `---
name: Test Skill
description: A test skill for testing
version: 1.0.0
variables: [topic, depth]
output: [findings, sources]
---

# Test Skill

This is a test skill.`;
            
            await createSkill('metadata-skill', skillContent);
            
            const result = await resolveSkillWithDetails('metadata-skill', tempDir);
            
            expect(result.metadata).toBeTruthy();
            expect(result.metadata!.name).toBe('Test Skill');
            expect(result.metadata!.description).toBe('A test skill for testing');
            expect(result.metadata!.version).toBe('1.0.0');
            expect(result.metadata!.variables).toEqual(['topic', 'depth']);
            expect(result.metadata!.output).toEqual(['findings', 'sources']);
            // Content should be the body after frontmatter is stripped
            expect(result.content).toBe('# Test Skill\n\nThis is a test skill.');
        });

        it('metadata is undefined when SKILL.md has no frontmatter', async () => {
            await createSkill('no-metadata', 'Just a prompt without frontmatter');
            
            const result = await resolveSkillWithDetails('no-metadata', tempDir);
            // When there's no frontmatter, metadata will have raw content but no parsed fields
            expect(result.metadata).toBeDefined();
            expect(result.metadata!.name).toBeUndefined();
            expect(result.metadata!.description).toBeUndefined();
        });
    });

    describe('resolveSkillWithDetailsSync', () => {
        it('returns full resolution details synchronously', async () => {
            await createSkill('sync-detailed', 'Sync detailed prompt');
            
            const result = resolveSkillWithDetailsSync('sync-detailed', tempDir);
            
            expect(result.content).toBe('Sync detailed prompt');
            expect(result.resolvedPath).toMatch(/SKILL\.md$/);
        });
    });

    describe('validateSkill', () => {
        it('returns valid for existing skill', async () => {
            await createSkill('valid-skill', 'Valid prompt');
            
            const result = validateSkill('valid-skill', tempDir);
            expect(result.valid).toBe(true);
            expect(result.skillPath).toBeTruthy();
        });

        it('returns invalid for non-existent skill', () => {
            const result = validateSkill('non-existent', tempDir);
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
            expect(result.error).toContain('not found');
        });

        it('returns invalid for empty skill name', () => {
            const result = validateSkill('', tempDir);
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
        });

        it('returns invalid for skill name with path traversal', () => {
            const result = validateSkill('../etc/passwd', tempDir);
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
            expect(result.error).toContain('path separators');
        });
    });

    describe('Cross-platform compatibility', () => {
        it('handles skill names with various characters', async () => {
            // Test skill names that are valid on all platforms
            const validNames = ['my-skill', 'my_skill', 'mySkill', 'skill123'];
            
            for (const name of validNames) {
                await createSkill(name, `Prompt for ${name}`);
                const result = await resolveSkill(name, tempDir);
                expect(result).toBe(`Prompt for ${name}`);
            }
        });

        it('rejects skill names with forward slashes', async () => {
            try {
                await resolveSkill('path/to/skill', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
            }
        });

        it('rejects skill names with backslashes', async () => {
            try {
                await resolveSkill('path\\to\\skill', tempDir);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(SkillResolverError);
            }
        });
    });

    describe('Custom skills directory', () => {
        it('resolves from custom skills directory', async () => {
            // Create custom skills directory
            const customSkillsDir = path.join(tempDir, 'custom', 'skills');
            await fs.promises.mkdir(customSkillsDir, { recursive: true });
            
            // Create skill in custom directory
            const skillDir = path.join(customSkillsDir, 'custom-skill');
            await fs.promises.mkdir(skillDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(skillDir, 'SKILL.md'),
                'Custom skill prompt'
            );
            
            const result = await resolveSkill('custom-skill', tempDir, 'custom/skills');
            expect(result).toBe('Custom skill prompt');
        });

        it('lists skills from custom directory', async () => {
            const customSkillsDir = path.join(tempDir, 'my-skills');
            await fs.promises.mkdir(customSkillsDir, { recursive: true });
            
            // Create skills in custom directory
            for (const name of ['skill-a', 'skill-b']) {
                const skillDir = path.join(customSkillsDir, name);
                await fs.promises.mkdir(skillDir, { recursive: true });
                await fs.promises.writeFile(
                    path.join(skillDir, 'SKILL.md'),
                    `Prompt for ${name}`
                );
            }
            
            const result = listSkills(tempDir, 'my-skills');
            expect(result).toEqual(['skill-a', 'skill-b']);
        });
    });

    describe('Multiline prompts', () => {
        it('preserves multiline prompt content', async () => {
            const multilinePrompt = `You are an expert researcher.

Given the topic: {{topic}}

Please:
1. Research deeply
2. Find sources
3. Synthesize findings

Return your findings in JSON format.`;
            
            await createSkill('multiline-skill', multilinePrompt);
            
            const result = await resolveSkill('multiline-skill', tempDir);
            expect(result).toBe(multilinePrompt);
        });

        it('handles Windows line endings', async () => {
            const windowsPrompt = 'Line 1\r\nLine 2\r\nLine 3';
            await createSkill('windows-skill', windowsPrompt);
            
            const result = await resolveSkill('windows-skill', tempDir);
            // Content should be preserved (trimmed)
            expect(result).toContain('Line 1');
            expect(result).toContain('Line 2');
            expect(result).toContain('Line 3');
        });
    });

    describe('Template variables in skills', () => {
        it('preserves template variables', async () => {
            const templatePrompt = `Analyze {{topic}} with depth {{depth}}.

Focus on: {{focus_areas}}

Return JSON with: {{output_fields}}`;
            
            await createSkill('template-skill', templatePrompt);
            
            const result = await resolveSkill('template-skill', tempDir);
            expect(result).toContain('{{topic}}');
            expect(result).toContain('{{depth}}');
            expect(result).toContain('{{focus_areas}}');
            expect(result).toContain('{{output_fields}}');
        });
    });
});
