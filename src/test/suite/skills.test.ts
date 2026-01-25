/**
 * Tests for the Skills module
 * Tests source detection, skill scanning, and installation
 */

import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { detectSource, SourceDetectionErrors } from '../../shortcuts/skills/source-detector';

suite('Skills Module Tests', () => {
    suite('Source Detection', () => {
        suite('GitHub URL Detection', () => {
            test('should detect full GitHub URL with tree/branch/path', () => {
                const result = detectSource('https://github.com/owner/repo/tree/main/.github/skills');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.type, 'github');
                    assert.strictEqual(result.source.github?.owner, 'owner');
                    assert.strictEqual(result.source.github?.repo, 'repo');
                    assert.strictEqual(result.source.github?.branch, 'main');
                    assert.strictEqual(result.source.github?.path, '.github/skills');
                }
            });

            test('should detect GitHub URL without protocol', () => {
                const result = detectSource('github.com/owner/repo/tree/develop/skills');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.type, 'github');
                    assert.strictEqual(result.source.github?.owner, 'owner');
                    assert.strictEqual(result.source.github?.repo, 'repo');
                    assert.strictEqual(result.source.github?.branch, 'develop');
                    assert.strictEqual(result.source.github?.path, 'skills');
                }
            });

            test('should detect GitHub URL with http protocol', () => {
                const result = detectSource('http://github.com/owner/repo/tree/main/path');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.type, 'github');
                }
            });

            test('should detect GitHub URL without path (defaults to root)', () => {
                const result = detectSource('https://github.com/owner/repo');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.type, 'github');
                    assert.strictEqual(result.source.github?.owner, 'owner');
                    assert.strictEqual(result.source.github?.repo, 'repo');
                    assert.strictEqual(result.source.github?.branch, 'main');
                    assert.strictEqual(result.source.github?.path, '');
                }
            });

            test('should handle GitHub URL with trailing slash', () => {
                const result = detectSource('https://github.com/owner/repo/tree/main/skills/');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.github?.path, 'skills');
                }
            });

            test('should handle blob URLs (file URLs)', () => {
                const result = detectSource('https://github.com/owner/repo/blob/main/skills/SKILL.md');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.type, 'github');
                    assert.strictEqual(result.source.github?.branch, 'main');
                    // Should get the directory containing the file
                    assert.strictEqual(result.source.github?.path, 'skills');
                }
            });
        });

        suite('Local Path Detection', () => {
            test('should detect absolute Unix path', () => {
                const result = detectSource('/Users/test/skills', '/workspace');
                
                assert.strictEqual(result.success, false); // Path doesn't exist
                if (!result.success) {
                    assert.ok(result.error.includes('Path not found'));
                }
            });

            test('should detect home directory path (~)', () => {
                const result = detectSource('~/my-skills', '/workspace');
                
                assert.strictEqual(result.success, false); // Path doesn't exist
                if (!result.success) {
                    assert.ok(result.error.includes('Path not found'));
                }
            });

            test('should detect relative path with ./', () => {
                const result = detectSource('./skills', '/workspace');
                
                assert.strictEqual(result.success, false); // Path doesn't exist
                if (!result.success) {
                    assert.ok(result.error.includes('Path not found'));
                }
            });

            test('should detect relative path with ../', () => {
                const result = detectSource('../skills', '/workspace');
                
                assert.strictEqual(result.success, false); // Path doesn't exist
                if (!result.success) {
                    assert.ok(result.error.includes('Path not found'));
                }
            });

            test('should detect Windows drive letter path', () => {
                const result = detectSource('C:/Users/test/skills', '/workspace');
                
                assert.strictEqual(result.success, false); // Path doesn't exist
                if (!result.success) {
                    assert.ok(result.error.includes('Path not found'));
                }
            });

            test('should detect Windows UNC path', () => {
                const result = detectSource('\\\\server\\share\\skills', '/workspace');
                
                assert.strictEqual(result.success, false); // Path doesn't exist
                if (!result.success) {
                    assert.ok(result.error.includes('Path not found'));
                }
            });

            test('should resolve existing local path', () => {
                // Use a path that exists on all platforms
                const existingPath = os.tmpdir();
                const result = detectSource(existingPath, '/workspace');
                
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.source.type, 'local');
                    assert.ok(result.source.localPath);
                }
            });
        });

        suite('Error Handling', () => {
            test('should return error for empty input', () => {
                const result = detectSource('');
                
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.strictEqual(result.error, SourceDetectionErrors.AMBIGUOUS);
                }
            });

            test('should return error for whitespace-only input', () => {
                const result = detectSource('   ');
                
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.strictEqual(result.error, SourceDetectionErrors.AMBIGUOUS);
                }
            });

            test('should return error for ambiguous input', () => {
                const result = detectSource('some-random-text');
                
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.strictEqual(result.error, SourceDetectionErrors.AMBIGUOUS);
                }
            });

            test('should return error for invalid GitHub URL (missing repo)', () => {
                const result = detectSource('https://github.com/owner');
                
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.strictEqual(result.error, SourceDetectionErrors.INVALID_GITHUB_URL);
                }
            });
        });
    });

    suite('Skill Scanning', () => {
        let tempDir: string;

        setup(() => {
            // Create a temporary directory for testing
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
        });

        teardown(() => {
            // Clean up temporary directory
            if (tempDir && fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test('should detect skill directory with SKILL.md', async () => {
            // Create a skill directory
            const skillDir = path.join(tempDir, 'my-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\n\nThis is a test skill.');

            // Import and test scanner
            const { scanForSkills } = await import('../../shortcuts/skills/skill-scanner');
            const result = await scanForSkills(
                { type: 'local', localPath: tempDir },
                path.join(tempDir, 'installed')
            );

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skills.length, 1);
            assert.strictEqual(result.skills[0].name, 'my-skill');
            assert.strictEqual(result.skills[0].description, 'This is a test skill.');
        });

        test('should detect multiple skills', async () => {
            // Create multiple skill directories
            const skill1Dir = path.join(tempDir, 'skill-1');
            const skill2Dir = path.join(tempDir, 'skill-2');
            fs.mkdirSync(skill1Dir);
            fs.mkdirSync(skill2Dir);
            fs.writeFileSync(path.join(skill1Dir, 'SKILL.md'), '# Skill 1\n\nFirst skill.');
            fs.writeFileSync(path.join(skill2Dir, 'SKILL.md'), '# Skill 2\n\nSecond skill.');

            const { scanForSkills } = await import('../../shortcuts/skills/skill-scanner');
            const result = await scanForSkills(
                { type: 'local', localPath: tempDir },
                path.join(tempDir, 'installed')
            );

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skills.length, 2);
            const names = result.skills.map(s => s.name).sort();
            assert.deepStrictEqual(names, ['skill-1', 'skill-2']);
        });

        test('should ignore directories without SKILL.md', async () => {
            // Create a directory without SKILL.md
            const notSkillDir = path.join(tempDir, 'not-a-skill');
            fs.mkdirSync(notSkillDir);
            fs.writeFileSync(path.join(notSkillDir, 'README.md'), '# Not a skill');

            // Create a valid skill
            const skillDir = path.join(tempDir, 'valid-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Valid Skill');

            const { scanForSkills } = await import('../../shortcuts/skills/skill-scanner');
            const result = await scanForSkills(
                { type: 'local', localPath: tempDir },
                path.join(tempDir, 'installed')
            );

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skills.length, 1);
            assert.strictEqual(result.skills[0].name, 'valid-skill');
        });

        test('should detect if skill already exists in install path', async () => {
            // Create a skill
            const skillDir = path.join(tempDir, 'existing-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Existing Skill');

            // Create install path with same skill name
            const installPath = path.join(tempDir, 'installed');
            fs.mkdirSync(installPath);
            fs.mkdirSync(path.join(installPath, 'existing-skill'));

            const { scanForSkills } = await import('../../shortcuts/skills/skill-scanner');
            const result = await scanForSkills(
                { type: 'local', localPath: tempDir },
                installPath
            );

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skills.length, 1);
            assert.strictEqual(result.skills[0].alreadyExists, true);
        });

        test('should return error for empty directory', async () => {
            const { scanForSkills } = await import('../../shortcuts/skills/skill-scanner');
            const result = await scanForSkills(
                { type: 'local', localPath: tempDir },
                path.join(tempDir, 'installed')
            );

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('No valid skills found'));
        });

        test('should handle single skill directory as source', async () => {
            // Create a skill directory directly
            fs.writeFileSync(path.join(tempDir, 'SKILL.md'), '# Direct Skill\n\nA skill at the root.');

            const { scanForSkills } = await import('../../shortcuts/skills/skill-scanner');
            const result = await scanForSkills(
                { type: 'local', localPath: tempDir },
                path.join(os.tmpdir(), 'installed')
            );

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skills.length, 1);
            assert.strictEqual(result.skills[0].description, 'A skill at the root.');
        });
    });

    suite('Skill Installation', () => {
        let sourceDir: string;
        let installDir: string;

        setup(() => {
            // Create temporary directories
            sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-source-'));
            installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-install-'));
        });

        teardown(() => {
            // Clean up
            if (sourceDir && fs.existsSync(sourceDir)) {
                fs.rmSync(sourceDir, { recursive: true, force: true });
            }
            if (installDir && fs.existsSync(installDir)) {
                fs.rmSync(installDir, { recursive: true, force: true });
            }
        });

        test('should install skill from local source', async () => {
            // Create a skill with files
            const skillDir = path.join(sourceDir, 'test-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill');
            fs.writeFileSync(path.join(skillDir, 'helper.js'), 'module.exports = {};');

            const { installSkills } = await import('../../shortcuts/skills/skill-installer');
            const result = await installSkills(
                [{ name: 'test-skill', path: skillDir }],
                { type: 'local', localPath: sourceDir },
                installDir,
                async () => true // Always replace
            );

            assert.strictEqual(result.installed, 1);
            assert.strictEqual(result.failed, 0);
            assert.strictEqual(result.skipped, 0);

            // Verify files were copied
            const installedSkillDir = path.join(installDir, 'test-skill');
            assert.ok(fs.existsSync(installedSkillDir));
            assert.ok(fs.existsSync(path.join(installedSkillDir, 'SKILL.md')));
            assert.ok(fs.existsSync(path.join(installedSkillDir, 'helper.js')));
        });

        test('should install skill with nested directories', async () => {
            // Create a skill with nested structure
            const skillDir = path.join(sourceDir, 'nested-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Nested Skill');
            
            const subDir = path.join(skillDir, 'templates');
            fs.mkdirSync(subDir);
            fs.writeFileSync(path.join(subDir, 'template.txt'), 'Template content');

            const { installSkills } = await import('../../shortcuts/skills/skill-installer');
            const result = await installSkills(
                [{ name: 'nested-skill', path: skillDir }],
                { type: 'local', localPath: sourceDir },
                installDir,
                async () => true
            );

            assert.strictEqual(result.installed, 1);

            // Verify nested structure
            const installedSkillDir = path.join(installDir, 'nested-skill');
            assert.ok(fs.existsSync(path.join(installedSkillDir, 'templates', 'template.txt')));
        });

        test('should skip skill when user declines replacement', async () => {
            // Create existing skill in install dir
            const existingDir = path.join(installDir, 'existing-skill');
            fs.mkdirSync(existingDir);
            fs.writeFileSync(path.join(existingDir, 'SKILL.md'), '# Old Version');

            // Create new version in source
            const skillDir = path.join(sourceDir, 'existing-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# New Version');

            const { installSkills } = await import('../../shortcuts/skills/skill-installer');
            const result = await installSkills(
                [{ name: 'existing-skill', path: skillDir, alreadyExists: true }],
                { type: 'local', localPath: sourceDir },
                installDir,
                async () => false // Decline replacement
            );

            assert.strictEqual(result.installed, 0);
            assert.strictEqual(result.skipped, 1);

            // Verify old version is preserved
            const content = fs.readFileSync(path.join(existingDir, 'SKILL.md'), 'utf-8');
            assert.ok(content.includes('Old Version'));
        });

        test('should replace skill when user confirms', async () => {
            // Create existing skill
            const existingDir = path.join(installDir, 'replace-skill');
            fs.mkdirSync(existingDir);
            fs.writeFileSync(path.join(existingDir, 'SKILL.md'), '# Old Version');

            // Create new version
            const skillDir = path.join(sourceDir, 'replace-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# New Version');

            const { installSkills } = await import('../../shortcuts/skills/skill-installer');
            const result = await installSkills(
                [{ name: 'replace-skill', path: skillDir, alreadyExists: true }],
                { type: 'local', localPath: sourceDir },
                installDir,
                async () => true // Confirm replacement
            );

            assert.strictEqual(result.installed, 1);
            assert.strictEqual(result.details[0].action, 'replaced');

            // Verify new version is installed
            const content = fs.readFileSync(path.join(installDir, 'replace-skill', 'SKILL.md'), 'utf-8');
            assert.ok(content.includes('New Version'));
        });

        test('should install multiple skills', async () => {
            // Create multiple skills
            for (let i = 1; i <= 3; i++) {
                const skillDir = path.join(sourceDir, `skill-${i}`);
                fs.mkdirSync(skillDir);
                fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# Skill ${i}`);
            }

            const { installSkills } = await import('../../shortcuts/skills/skill-installer');
            const result = await installSkills(
                [
                    { name: 'skill-1', path: path.join(sourceDir, 'skill-1') },
                    { name: 'skill-2', path: path.join(sourceDir, 'skill-2') },
                    { name: 'skill-3', path: path.join(sourceDir, 'skill-3') }
                ],
                { type: 'local', localPath: sourceDir },
                installDir,
                async () => true
            );

            assert.strictEqual(result.installed, 3);
            assert.strictEqual(result.failed, 0);

            // Verify all skills installed
            for (let i = 1; i <= 3; i++) {
                assert.ok(fs.existsSync(path.join(installDir, `skill-${i}`, 'SKILL.md')));
            }
        });

        test('should create install directory if it does not exist', async () => {
            const newInstallDir = path.join(installDir, 'new', 'nested', 'path');
            
            // Create a skill
            const skillDir = path.join(sourceDir, 'auto-create-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Auto Create');

            const { installSkills } = await import('../../shortcuts/skills/skill-installer');
            const result = await installSkills(
                [{ name: 'auto-create-skill', path: skillDir }],
                { type: 'local', localPath: sourceDir },
                newInstallDir,
                async () => true
            );

            assert.strictEqual(result.installed, 1);
            assert.ok(fs.existsSync(path.join(newInstallDir, 'auto-create-skill', 'SKILL.md')));
        });
    });

    suite('Cross-Platform Path Handling', () => {
        test('should handle paths with spaces', () => {
            // Test path detection with spaces
            const result = detectSource('/Users/test user/my skills', '/workspace');
            
            // Should be detected as local path (even if it doesn't exist)
            assert.strictEqual(result.success, false);
            if (!result.success) {
                assert.ok(result.error.includes('Path not found'));
            }
        });

        test('should normalize path separators', () => {
            // Use temp directory which exists
            const existingPath = os.tmpdir();
            const result = detectSource(existingPath, '/workspace');
            
            assert.strictEqual(result.success, true);
            if (result.success) {
                // Path should be normalized
                assert.ok(!result.source.localPath?.includes('\\\\') || process.platform === 'win32');
            }
        });

        test('should expand home directory correctly', () => {
            const homeDir = os.homedir();
            const result = detectSource('~', '/workspace');
            
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.source.localPath, homeDir);
            }
        });
    });
});
