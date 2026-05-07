import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { getBundledSkills } from '../../src/skills/bundled-skills-provider';
import {
    autoInstallMyWorkSkills,
    getMyWorkSkillsPath,
} from '../../src/skills/my-work-skills-provider';

const SKILL_NAME = 'swe-1on1-notes';

describe('getMyWorkSkillsPath', () => {
    it('returns a string path', () => {
        const p = getMyWorkSkillsPath();
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
    });
});

describe('autoInstallMyWorkSkills', () => {
    let installDir: string;

    beforeEach(() => {
        installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-work-skills-'));
    });

    afterEach(() => {
        fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('installs swe-1on1-notes into an empty target directory', async () => {
        const result = await autoInstallMyWorkSkills(installDir);

        expect(result.errors).toHaveLength(0);
        expect(result.installed).toEqual([SKILL_NAME]);
        expect(result.skipped).toHaveLength(0);
        expect(fs.existsSync(path.join(installDir, SKILL_NAME, 'SKILL.md'))).toBe(true);
    });

    it('is idempotent and skips an already-installed skill', async () => {
        await autoInstallMyWorkSkills(installDir);

        const result = await autoInstallMyWorkSkills(installDir);

        expect(result.errors).toHaveLength(0);
        expect(result.installed).toHaveLength(0);
        expect(result.skipped).toEqual([SKILL_NAME]);
    });

    it('does not overwrite existing target content', async () => {
        const skillDir = path.join(installDir, SKILL_NAME);
        fs.mkdirSync(skillDir, { recursive: true });
        const skillFile = path.join(skillDir, 'SKILL.md');
        const sentinelFile = path.join(skillDir, 'SENTINEL');
        fs.writeFileSync(skillFile, '# Local version\n', 'utf-8');
        fs.writeFileSync(sentinelFile, 'local edits', 'utf-8');

        const result = await autoInstallMyWorkSkills(installDir);

        expect(result.errors).toHaveLength(0);
        expect(result.installed).toHaveLength(0);
        expect(result.skipped).toEqual([SKILL_NAME]);
        expect(fs.readFileSync(skillFile, 'utf-8')).toBe('# Local version\n');
        expect(fs.readFileSync(sentinelFile, 'utf-8')).toBe('local edits');
    });
});

describe('My Work skill metadata', () => {
    it('has valid frontmatter matching the skill folder', () => {
        const skillFile = path.join(getMyWorkSkillsPath(), SKILL_NAME, 'SKILL.md');
        const content = fs.readFileSync(skillFile, 'utf-8');
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

        expect(fmMatch, `${SKILL_NAME}/SKILL.md should have YAML frontmatter`).toBeTruthy();

        const parsed = yaml.parse(fmMatch![1]);
        expect(parsed.name).toBe(SKILL_NAME);
        expect(typeof parsed.description).toBe('string');
        expect(parsed.description.length).toBeGreaterThan(0);
        expect(parsed.metadata?.version).toBe('0.0.1');
    });

    it('is not part of the general bundled skills registry', () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-skills-'));
        try {
            const names = getBundledSkills(installDir).map(skill => skill.name);
            expect(names).not.toContain(SKILL_NAME);
        } finally {
            fs.rmSync(installDir, { recursive: true, force: true });
        }
    });
});
