/**
 * Tests for Codex Skill Mirror
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getCodexHome,
    getCodexSkillsDir,
    mirrorBundledSkillToCodex,
    mirrorBundledSkillsToCodex,
    type MirrorResult,
} from '../../../src/server/skills/codex-skill-mirror';

describe('codex-skill-mirror', () => {
    let tempDir: string;
    let cocSkillsDir: string;
    let codexHome: string;
    let originalCodexHome: string | undefined;

    beforeEach(() => {
        // Create temp directories for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mirror-test-'));
        cocSkillsDir = path.join(tempDir, 'coc-skills');
        codexHome = path.join(tempDir, 'codex-home');

        fs.mkdirSync(cocSkillsDir, { recursive: true });
        fs.mkdirSync(codexHome, { recursive: true });

        // Mock CODEX_HOME
        originalCodexHome = process.env.CODEX_HOME;
        process.env.CODEX_HOME = codexHome;
    });

    afterEach(() => {
        // Restore original CODEX_HOME
        if (originalCodexHome !== undefined) {
            process.env.CODEX_HOME = originalCodexHome;
        } else {
            delete process.env.CODEX_HOME;
        }

        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('getCodexHome', () => {
        it('should use CODEX_HOME when set', () => {
            process.env.CODEX_HOME = '/custom/codex/home';
            expect(getCodexHome()).toBe('/custom/codex/home');
        });

        it('should fall back to ~/.codex when CODEX_HOME is not set', () => {
            delete process.env.CODEX_HOME;
            expect(getCodexHome()).toBe(path.join(os.homedir(), '.codex'));
        });
    });

    describe('getCodexSkillsDir', () => {
        it('should return skills subdirectory of Codex home', () => {
            process.env.CODEX_HOME = '/custom/codex/home';
            expect(getCodexSkillsDir()).toBe(path.join('/custom/codex/home', 'skills'));
        });
    });

    describe('mirrorBundledSkillToCodex', () => {
        function createSkill(skillName: string, version?: string): void {
            const skillPath = path.join(cocSkillsDir, skillName);
            fs.mkdirSync(skillPath, { recursive: true });
            
            let content = '---\n';
            if (version) {
                content += `metadata:\n  version: ${version}\n`;
            }
            content += '---\n\n# Skill\n\nContent';
            
            fs.writeFileSync(path.join(skillPath, 'SKILL.md'), content);
            
            // Create nested files
            const refsDir = path.join(skillPath, 'references');
            fs.mkdirSync(refsDir, { recursive: true });
            fs.writeFileSync(path.join(refsDir, 'ref.md'), '# Reference');
        }

        it('should copy new skill to Codex', async () => {
            createSkill('test-skill', '1.0.0');

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', false);

            expect(result.status).toBe('copied');
            expect(result.skillName).toBe('test-skill');

            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            expect(fs.existsSync(path.join(codexSkillPath, 'SKILL.md'))).toBe(true);
            expect(fs.existsSync(path.join(codexSkillPath, 'references', 'ref.md'))).toBe(true);
            expect(fs.existsSync(path.join(codexSkillPath, '.coc-skill.json'))).toBe(true);

            const marker = JSON.parse(fs.readFileSync(path.join(codexSkillPath, '.coc-skill.json'), 'utf-8'));
            expect(marker.source).toBe('coc-bundled');
            expect(marker.name).toBe('test-skill');
            expect(marker.version).toBe('1.0.0');
        });

        it('should fail if source skill does not exist', async () => {
            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'nonexistent', false);

            expect(result.status).toBe('failed');
            expect(result.error).toContain('does not exist');
        });

        it('should skip .system directory', async () => {
            createSkill('.system');

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, '.system', false);

            expect(result.status).toBe('skipped-existing-user-managed');
            expect(result.error).toContain('.system');
        });

        it('should skip existing user-managed skill when replace is false', async () => {
            createSkill('test-skill', '1.0.0');

            // Create existing user skill without marker
            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            fs.mkdirSync(codexSkillPath, { recursive: true });
            fs.writeFileSync(path.join(codexSkillPath, 'SKILL.md'), '# User skill');

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', false);

            expect(result.status).toBe('skipped-existing-user-managed');
            expect(fs.readFileSync(path.join(codexSkillPath, 'SKILL.md'), 'utf-8')).toBe('# User skill');
        });

        it('should replace existing user-managed skill when replace is true', async () => {
            createSkill('test-skill', '1.0.0');

            // Create existing user skill without marker
            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            fs.mkdirSync(codexSkillPath, { recursive: true });
            fs.writeFileSync(path.join(codexSkillPath, 'SKILL.md'), '# User skill');

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', true);

            expect(result.status).toBe('copied');
            expect(fs.readFileSync(path.join(codexSkillPath, 'SKILL.md'), 'utf-8')).toContain('# Skill');
        });

        it('should update when source version is newer', async () => {
            createSkill('test-skill', '2.0.0');

            // Create existing CoC-managed skill with older version
            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            fs.mkdirSync(codexSkillPath, { recursive: true });
            fs.writeFileSync(
                path.join(codexSkillPath, 'SKILL.md'),
                '---\nmetadata:\n  version: 1.0.0\n---\n\n# Old skill'
            );
            fs.writeFileSync(
                path.join(codexSkillPath, '.coc-skill.json'),
                JSON.stringify({ source: 'coc-bundled', name: 'test-skill', version: '1.0.0' })
            );

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', false);

            expect(result.status).toBe('updated');
            expect(fs.readFileSync(path.join(codexSkillPath, 'SKILL.md'), 'utf-8')).toContain('2.0.0');
        });

        it('should skip when versions are the same', async () => {
            createSkill('test-skill', '1.0.0');

            // Create existing CoC-managed skill with same version
            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            fs.mkdirSync(codexSkillPath, { recursive: true });
            fs.writeFileSync(
                path.join(codexSkillPath, 'SKILL.md'),
                '---\nmetadata:\n  version: 1.0.0\n---\n\n# Skill'
            );
            fs.writeFileSync(
                path.join(codexSkillPath, '.coc-skill.json'),
                JSON.stringify({ source: 'coc-bundled', name: 'test-skill', version: '1.0.0' })
            );

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', false);

            expect(result.status).toBe('skipped-same-version');
            expect(result.error).toContain('1.0.0');
        });

        it('should skip when target version is newer', async () => {
            createSkill('test-skill', '1.0.0');

            // Create existing CoC-managed skill with newer version
            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            fs.mkdirSync(codexSkillPath, { recursive: true });
            fs.writeFileSync(
                path.join(codexSkillPath, 'SKILL.md'),
                '---\nmetadata:\n  version: 2.0.0\n---\n\n# Newer skill'
            );
            fs.writeFileSync(
                path.join(codexSkillPath, '.coc-skill.json'),
                JSON.stringify({ source: 'coc-bundled', name: 'test-skill', version: '2.0.0' })
            );

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', false);

            expect(result.status).toBe('skipped-newer-target');
        });

        it('should preserve nested directory structure', async () => {
            const skillPath = path.join(cocSkillsDir, 'test-skill');
            fs.mkdirSync(skillPath, { recursive: true });
            fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# Skill');

            // Create nested structure
            fs.mkdirSync(path.join(skillPath, 'references'), { recursive: true });
            fs.mkdirSync(path.join(skillPath, 'scripts'), { recursive: true });
            fs.mkdirSync(path.join(skillPath, 'assets', 'images'), { recursive: true });

            fs.writeFileSync(path.join(skillPath, 'references', 'api.md'), '# API');
            fs.writeFileSync(path.join(skillPath, 'scripts', 'test.sh'), '#!/bin/bash');
            fs.writeFileSync(path.join(skillPath, 'assets', 'images', 'logo.png'), 'PNG');

            const result = await mirrorBundledSkillToCodex(cocSkillsDir, 'test-skill', false);

            expect(result.status).toBe('copied');

            const codexSkillPath = path.join(codexHome, 'skills', 'test-skill');
            expect(fs.existsSync(path.join(codexSkillPath, 'references', 'api.md'))).toBe(true);
            expect(fs.existsSync(path.join(codexSkillPath, 'scripts', 'test.sh'))).toBe(true);
            expect(fs.existsSync(path.join(codexSkillPath, 'assets', 'images', 'logo.png'))).toBe(true);
        });
    });

    describe('mirrorBundledSkillsToCodex', () => {
        it('should mirror multiple skills', async () => {
            // Create multiple skills
            const skillNames = ['skill-a', 'skill-b', 'skill-c'];
            for (const name of skillNames) {
                const skillPath = path.join(cocSkillsDir, name);
                fs.mkdirSync(skillPath, { recursive: true });
                fs.writeFileSync(path.join(skillPath, 'SKILL.md'), `# ${name}`);
            }

            const results = await mirrorBundledSkillsToCodex(cocSkillsDir, skillNames, false);

            expect(results).toHaveLength(3);
            expect(results.every(r => r.status === 'copied')).toBe(true);

            for (const name of skillNames) {
                const codexSkillPath = path.join(codexHome, 'skills', name);
                expect(fs.existsSync(path.join(codexSkillPath, 'SKILL.md'))).toBe(true);
            }
        });

        it('should handle mixed success and failure', async () => {
            // Create one valid skill
            const skillPath = path.join(cocSkillsDir, 'valid-skill');
            fs.mkdirSync(skillPath, { recursive: true });
            fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# Valid');

            const results = await mirrorBundledSkillsToCodex(
                cocSkillsDir,
                ['valid-skill', 'invalid-skill'],
                false
            );

            expect(results).toHaveLength(2);
            expect(results[0].status).toBe('copied');
            expect(results[0].skillName).toBe('valid-skill');
            expect(results[1].status).toBe('failed');
            expect(results[1].skillName).toBe('invalid-skill');
        });
    });
});
