/**
 * Tests for skill-installer logic (local source).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { installSkills } from '../../src/skills/skill-installer';
import type { DiscoveredSkill, ParsedSource } from '../../src/skills/types';

describe('installSkills (local source)', () => {
    let sourceDir: string;
    let installDir: string;

    beforeEach(() => {
        sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-src-'));
        installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-dst-'));

        // Create a skill in the source dir
        const skill1 = path.join(sourceDir, 'skill-a');
        fs.mkdirSync(skill1);
        fs.writeFileSync(path.join(skill1, 'SKILL.md'), '# Skill A\nA test skill');
        fs.writeFileSync(path.join(skill1, 'prompt.md'), 'Do things');
    });

    afterEach(() => {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('installs a skill from local source', async () => {
        const source: ParsedSource = {
            type: 'local',
            localPath: sourceDir,
        };

        const skills: DiscoveredSkill[] = [{
            name: 'skill-a',
            description: 'A test skill',
            path: path.join(sourceDir, 'skill-a'),
            alreadyExists: false,
        }];

        const result = await installSkills(skills, source, installDir, async () => false);
        expect(result.installed).toBe(1);
        expect(result.failed).toBe(0);
        expect(fs.existsSync(path.join(installDir, 'skill-a', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(installDir, 'skill-a', 'prompt.md'))).toBe(true);
    });

    it('skips skill when conflict handler returns false', async () => {
        // Pre-install the skill
        const existingSkill = path.join(installDir, 'skill-a');
        fs.mkdirSync(existingSkill);
        fs.writeFileSync(path.join(existingSkill, 'SKILL.md'), '# Old');

        const source: ParsedSource = {
            type: 'local',
            localPath: sourceDir,
        };

        const skills: DiscoveredSkill[] = [{
            name: 'skill-a',
            description: 'A test skill',
            path: path.join(sourceDir, 'skill-a'),
            alreadyExists: true,
        }];

        const result = await installSkills(skills, source, installDir, async () => false);
        expect(result.skipped).toBe(1);
        expect(result.installed).toBe(0);

        // Old file should still be there
        expect(fs.readFileSync(path.join(installDir, 'skill-a', 'SKILL.md'), 'utf-8')).toContain('Old');
    });

    it('replaces skill when conflict handler returns true', async () => {
        // Pre-install the skill
        const existingSkill = path.join(installDir, 'skill-a');
        fs.mkdirSync(existingSkill);
        fs.writeFileSync(path.join(existingSkill, 'SKILL.md'), '# Old');

        const source: ParsedSource = {
            type: 'local',
            localPath: sourceDir,
        };

        const skills: DiscoveredSkill[] = [{
            name: 'skill-a',
            description: 'A test skill',
            path: path.join(sourceDir, 'skill-a'),
            alreadyExists: true,
        }];

        const result = await installSkills(skills, source, installDir, async () => true);
        expect(result.installed).toBe(1);
        expect(result.failed).toBe(0);

        // New file should be there
        expect(fs.readFileSync(path.join(installDir, 'skill-a', 'SKILL.md'), 'utf-8')).toContain('Skill A');
    });

    it('handles multiple skills in one call', async () => {
        // Create second skill
        const skill2 = path.join(sourceDir, 'skill-b');
        fs.mkdirSync(skill2);
        fs.writeFileSync(path.join(skill2, 'SKILL.md'), '# Skill B');

        const source: ParsedSource = {
            type: 'local',
            localPath: sourceDir,
        };

        const skills: DiscoveredSkill[] = [
            { name: 'skill-a', description: 'A', path: path.join(sourceDir, 'skill-a'), alreadyExists: false },
            { name: 'skill-b', description: 'B', path: path.join(sourceDir, 'skill-b'), alreadyExists: false },
        ];

        const result = await installSkills(skills, source, installDir, async () => false);
        expect(result.installed).toBe(2);
        expect(result.failed).toBe(0);
    });

    it('returns failed result for invalid source type', async () => {
        const source: ParsedSource = {
            type: 'bundled',
        };

        const skills: DiscoveredSkill[] = [{
            name: 'skill-a',
            description: 'A',
            path: path.join(sourceDir, 'skill-a'),
            alreadyExists: false,
        }];

        const result = await installSkills(skills, source, installDir, async () => false);
        expect(result.failed).toBe(1);
        expect(result.details[0].action).toBe('failed');
    });
});
