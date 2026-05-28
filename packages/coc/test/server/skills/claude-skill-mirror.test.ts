/**
 * Tests for Claude Skill Mirror
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getClaudeHome,
    getClaudeCommandsDir,
    getMarkerPath,
    mirrorBundledSkillToClaude,
    mirrorBundledSkillsToClaude,
    syncInstalledSkillsToClaude,
    type MirrorResult,
} from '../../../src/server/skills/claude-skill-mirror';

describe('claude-skill-mirror', () => {
    let tempDir: string;
    let cocSkillsDir: string;
    let claudeHome: string;
    let originalClaudeHome: string | undefined;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mirror-test-'));
        cocSkillsDir = path.join(tempDir, 'coc-skills');
        claudeHome = path.join(tempDir, 'claude-home');

        fs.mkdirSync(cocSkillsDir, { recursive: true });
        fs.mkdirSync(claudeHome, { recursive: true });

        originalClaudeHome = process.env.CLAUDE_HOME;
        process.env.CLAUDE_HOME = claudeHome;
    });

    afterEach(() => {
        if (originalClaudeHome !== undefined) {
            process.env.CLAUDE_HOME = originalClaudeHome;
        } else {
            delete process.env.CLAUDE_HOME;
        }

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // -----------------------------------------------------------------------
    // Path helpers
    // -----------------------------------------------------------------------

    describe('getClaudeHome', () => {
        it('returns CLAUDE_HOME when set', () => {
            process.env.CLAUDE_HOME = '/custom/claude';
            expect(getClaudeHome()).toBe('/custom/claude');
        });

        it('falls back to ~/.claude when CLAUDE_HOME is not set', () => {
            delete process.env.CLAUDE_HOME;
            expect(getClaudeHome()).toBe(path.join(os.homedir(), '.claude'));
        });
    });

    describe('getClaudeCommandsDir', () => {
        it('returns commands subdirectory of Claude home', () => {
            process.env.CLAUDE_HOME = '/custom/claude';
            expect(getClaudeCommandsDir()).toBe(path.join('/custom/claude', 'commands'));
        });
    });

    describe('getMarkerPath', () => {
        it('returns .coc-<name>.json sidecar path', () => {
            const commandsDir = path.join(claudeHome, 'commands');
            expect(getMarkerPath(commandsDir, 'grill-me')).toBe(
                path.join(commandsDir, '.coc-grill-me.json'),
            );
        });
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function createSkill(skillName: string, version?: string, extra?: string): void {
        const skillPath = path.join(cocSkillsDir, skillName);
        fs.mkdirSync(skillPath, { recursive: true });

        let content = '---\n';
        if (version) {
            content += `metadata:\n  version: ${version}\n`;
        }
        content += `---\n\n# ${skillName}\n\n${extra ?? 'Content'}`;

        fs.writeFileSync(path.join(skillPath, 'SKILL.md'), content);
    }

    function commandsDir(): string {
        return path.join(claudeHome, 'commands');
    }

    function commandFile(skillName: string): string {
        return path.join(commandsDir(), `${skillName}.md`);
    }

    function markerFile(skillName: string): string {
        return getMarkerPath(commandsDir(), skillName);
    }

    function readMarkerJson(skillName: string): Record<string, unknown> {
        return JSON.parse(fs.readFileSync(markerFile(skillName), 'utf-8'));
    }

    // -----------------------------------------------------------------------
    // mirrorBundledSkillToClaude — new skill
    // -----------------------------------------------------------------------

    describe('mirrorBundledSkillToClaude — new skill', () => {
        it('copies SKILL.md as <name>.md and writes sidecar marker', async () => {
            createSkill('grill-me', '1.0.0');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'grill-me');

            expect(result.status).toBe('copied');
            expect(result.skillName).toBe('grill-me');

            // Command file exists with correct content
            const cmd = fs.readFileSync(commandFile('grill-me'), 'utf-8');
            expect(cmd).toContain('# grill-me');

            // Sidecar marker is valid
            const marker = readMarkerJson('grill-me');
            expect(marker.source).toBe('coc-bundled');
            expect(marker.name).toBe('grill-me');
            expect(marker.version).toBe('1.0.0');
        });

        it('creates the commands directory when missing', async () => {
            createSkill('new-skill', '0.1.0');
            // commandsDir does not exist yet
            expect(fs.existsSync(commandsDir())).toBe(false);

            await mirrorBundledSkillToClaude(cocSkillsDir, 'new-skill');

            expect(fs.existsSync(commandsDir())).toBe(true);
            expect(fs.existsSync(commandFile('new-skill'))).toBe(true);
        });

        it('records undefined version in marker when SKILL.md has no version field', async () => {
            createSkill('no-version-skill');

            await mirrorBundledSkillToClaude(cocSkillsDir, 'no-version-skill');

            const marker = readMarkerJson('no-version-skill');
            expect(marker.version).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // mirrorBundledSkillToClaude — source validation
    // -----------------------------------------------------------------------

    describe('mirrorBundledSkillToClaude — source validation', () => {
        it('returns failed when source skill directory is missing', async () => {
            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'nonexistent');
            expect(result.status).toBe('failed');
            expect(result.error).toContain('does not exist');
        });

        it('returns failed when source SKILL.md is missing', async () => {
            // Create directory without SKILL.md
            fs.mkdirSync(path.join(cocSkillsDir, 'bad-skill'), { recursive: true });
            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'bad-skill');
            expect(result.status).toBe('failed');
            expect(result.error).toContain('does not exist');
        });

        it('skips .system skill', async () => {
            createSkill('.system');
            const result = await mirrorBundledSkillToClaude(cocSkillsDir, '.system');
            expect(result.status).toBe('skipped-existing-user-managed');
            expect(result.error).toContain('.system');
        });
    });

    // -----------------------------------------------------------------------
    // mirrorBundledSkillToClaude — user-managed conflict
    // -----------------------------------------------------------------------

    describe('mirrorBundledSkillToClaude — user-managed conflict', () => {
        it('skips existing command without marker when replace is false', async () => {
            createSkill('my-skill', '1.0.0');

            // User wrote their own command file (no sidecar marker)
            fs.mkdirSync(commandsDir(), { recursive: true });
            fs.writeFileSync(commandFile('my-skill'), '# My custom command');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'my-skill', false);

            expect(result.status).toBe('skipped-existing-user-managed');
            // Original user content preserved
            expect(fs.readFileSync(commandFile('my-skill'), 'utf-8')).toBe('# My custom command');
        });

        it('replaces existing command without marker when replace is true', async () => {
            createSkill('my-skill', '1.0.0');

            fs.mkdirSync(commandsDir(), { recursive: true });
            fs.writeFileSync(commandFile('my-skill'), '# My custom command');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'my-skill', true);

            expect(result.status).toBe('copied');
            expect(fs.readFileSync(commandFile('my-skill'), 'utf-8')).toContain('# my-skill');
            // Sidecar marker created
            expect(fs.existsSync(markerFile('my-skill'))).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // mirrorBundledSkillToClaude — CoC-managed version logic
    // -----------------------------------------------------------------------

    describe('mirrorBundledSkillToClaude — CoC-managed version logic', () => {
        function installCoC(skillName: string, version: string): void {
            fs.mkdirSync(commandsDir(), { recursive: true });
            const content = `---\nmetadata:\n  version: ${version}\n---\n\n# ${skillName}`;
            fs.writeFileSync(commandFile(skillName), content);
            const marker = { source: 'coc-bundled', name: skillName, version };
            fs.writeFileSync(markerFile(skillName), JSON.stringify(marker, null, 2));
        }

        it('updates when source version is newer', async () => {
            createSkill('grill-me', '2.0.0', 'New content');
            installCoC('grill-me', '1.0.0');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'grill-me');

            expect(result.status).toBe('updated');
            expect(fs.readFileSync(commandFile('grill-me'), 'utf-8')).toContain('2.0.0');
            expect(readMarkerJson('grill-me').version).toBe('2.0.0');
        });

        it('skips when versions are equal', async () => {
            createSkill('grill-me', '1.0.0');
            installCoC('grill-me', '1.0.0');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'grill-me');

            expect(result.status).toBe('skipped-same-version');
            expect(result.error).toContain('1.0.0');
        });

        it('skips when target version is newer', async () => {
            createSkill('grill-me', '1.0.0');
            installCoC('grill-me', '2.0.0');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'grill-me');

            expect(result.status).toBe('skipped-newer-target');
        });

        it('skips update when source has no version', async () => {
            createSkill('grill-me'); // no version
            installCoC('grill-me', '1.0.0');

            const result = await mirrorBundledSkillToClaude(cocSkillsDir, 'grill-me');

            // Cannot compare — falls to skipped-newer-target (target version wins)
            expect(['skipped-newer-target', 'skipped-same-version']).toContain(result.status);
        });
    });

    // -----------------------------------------------------------------------
    // mirrorBundledSkillsToClaude — batch
    // -----------------------------------------------------------------------

    describe('mirrorBundledSkillsToClaude', () => {
        it('mirrors multiple skills and returns one result each', async () => {
            for (const name of ['skill-a', 'skill-b', 'skill-c']) {
                createSkill(name, '1.0.0');
            }

            const results = await mirrorBundledSkillsToClaude(
                cocSkillsDir,
                ['skill-a', 'skill-b', 'skill-c'],
            );

            expect(results).toHaveLength(3);
            expect(results.every(r => r.status === 'copied')).toBe(true);

            for (const name of ['skill-a', 'skill-b', 'skill-c']) {
                expect(fs.existsSync(commandFile(name))).toBe(true);
                expect(fs.existsSync(markerFile(name))).toBe(true);
            }
        });

        it('handles mixed success and failure', async () => {
            createSkill('valid-skill', '1.0.0');
            // 'invalid-skill' has no SKILL.md

            const results = await mirrorBundledSkillsToClaude(
                cocSkillsDir,
                ['valid-skill', 'invalid-skill'],
            );

            expect(results).toHaveLength(2);
            expect(results[0].status).toBe('copied');
            expect(results[0].skillName).toBe('valid-skill');
            expect(results[1].status).toBe('failed');
            expect(results[1].skillName).toBe('invalid-skill');
        });
    });

    // -----------------------------------------------------------------------
    // syncInstalledSkillsToClaude
    // -----------------------------------------------------------------------

    describe('syncInstalledSkillsToClaude', () => {
        it('returns empty results when cocSkillsDir does not exist', async () => {
            const result = await syncInstalledSkillsToClaude(
                path.join(tempDir, 'nonexistent'),
            );
            expect(result.synced).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
        });

        it('returns empty results when cocSkillsDir is empty', async () => {
            const result = await syncInstalledSkillsToClaude(cocSkillsDir);
            expect(result.synced).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
        });

        it('syncs all skill directories', async () => {
            createSkill('alpha', '1.0.0');
            createSkill('beta', '2.0.0');

            const result = await syncInstalledSkillsToClaude(cocSkillsDir);

            expect(result.synced.sort()).toEqual(['alpha', 'beta']);
            expect(result.errors).toHaveLength(0);
            expect(fs.existsSync(commandFile('alpha'))).toBe(true);
            expect(fs.existsSync(commandFile('beta'))).toBe(true);
        });

        it('excludes .system directory from sync', async () => {
            createSkill('.system');
            createSkill('real-skill', '1.0.0');

            const result = await syncInstalledSkillsToClaude(cocSkillsDir);

            expect(result.synced).toEqual(['real-skill']);
            expect(fs.existsSync(commandFile('.system'))).toBe(false);
        });

        it('reports already-up-to-date skills as neither synced nor errors', async () => {
            createSkill('skill-a', '1.0.0');
            // Install same version as CoC-managed
            fs.mkdirSync(commandsDir(), { recursive: true });
            const content = '---\nmetadata:\n  version: 1.0.0\n---\n\n# skill-a';
            fs.writeFileSync(commandFile('skill-a'), content);
            const marker = { source: 'coc-bundled', name: 'skill-a', version: '1.0.0' };
            fs.writeFileSync(markerFile('skill-a'), JSON.stringify(marker, null, 2));

            const result = await syncInstalledSkillsToClaude(cocSkillsDir);

            expect(result.synced).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
        });

        it('skips non-directory entries in cocSkillsDir', async () => {
            // Create a plain file (not a directory) in the skills dir
            fs.writeFileSync(path.join(cocSkillsDir, 'readme.txt'), 'ignore me');
            createSkill('real-skill', '1.0.0');

            const result = await syncInstalledSkillsToClaude(cocSkillsDir);

            expect(result.synced).toEqual(['real-skill']);
        });
    });
});
