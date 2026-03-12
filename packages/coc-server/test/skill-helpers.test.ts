import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    FRONTMATTER_REGEX,
    DESCRIPTION_REGEX,
    VERSION_REGEX,
    VARIABLES_REGEX,
    OUTPUT_REGEX,
    parseSkillMd,
    parseYamlDescription,
    extractDescriptionFromMarkdown,
    listDirectoryFiles,
    listInstalledSkills,
    getSkillDetail,
} from '../src/skill-handler';
import type { SkillInfo } from '../src/skill-handler';

describe('shared skill helpers', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-helpers-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── Regex constants ──────────────────────────────────────

    describe('regex constants', () => {
        it('FRONTMATTER_REGEX matches YAML frontmatter', () => {
            const md = '---\nname: test\ndescription: hello\n---\n# Body';
            const m = md.match(FRONTMATTER_REGEX);
            expect(m).toBeTruthy();
            expect(m![1]).toContain('name: test');
        });

        it('DESCRIPTION_REGEX matches description line', () => {
            const m = 'description: My skill'.match(DESCRIPTION_REGEX);
            expect(m).toBeTruthy();
            expect(m![1]).toBe('My skill');
        });

        it('VERSION_REGEX matches version line', () => {
            const m = 'version: "1.2.3"'.match(VERSION_REGEX);
            expect(m).toBeTruthy();
            expect(m![1]).toBe('1.2.3');
        });

        it('VARIABLES_REGEX matches variables array', () => {
            const m = 'variables: ["a", "b"]'.match(VARIABLES_REGEX);
            expect(m).toBeTruthy();
            expect(m![1]).toContain('"a"');
        });

        it('OUTPUT_REGEX matches output array', () => {
            const m = 'output: ["x"]'.match(OUTPUT_REGEX);
            expect(m).toBeTruthy();
            expect(m![1]).toContain('"x"');
        });
    });

    // ── parseSkillMd ─────────────────────────────────────────

    describe('parseSkillMd', () => {
        it('parses frontmatter with all fields', () => {
            const md = [
                '---',
                'description: A test skill',
                'version: 2.0.0',
                'variables: ["input", "output"]',
                'output: ["result"]',
                '---',
                '# Instructions',
                'Do stuff.',
            ].join('\n');

            const result = parseSkillMd(md);
            expect(result.description).toBe('A test skill');
            expect(result.version).toBe('2.0.0');
            expect(result.variables).toEqual(['input', 'output']);
            expect(result.output).toEqual(['result']);
            expect(result.promptBody).toContain('# Instructions');
        });

        it('falls back to extractDescriptionFromMarkdown when no frontmatter', () => {
            const md = '# My Skill\nThis is the description.\nMore text.';
            const result = parseSkillMd(md);
            expect(result.description).toBe('This is the description.');
            expect(result.promptBody).toBe(md.trim());
        });

        it('returns undefined fields for empty content', () => {
            const result = parseSkillMd('');
            expect(result.description).toBeUndefined();
            expect(result.version).toBeUndefined();
            expect(result.promptBody).toBeUndefined();
        });
    });

    // ── parseYamlDescription ─────────────────────────────────

    describe('parseYamlDescription', () => {
        it('parses single-line description', () => {
            expect(parseYamlDescription('description: A simple skill')).toBe('A simple skill');
        });

        it('parses block literal (|) multiline description', () => {
            const fm = [
                'name: humanizer',
                'description: |',
                '  Remove signs of AI-generated writing.',
                '  Based on Wikipedia guide.',
            ].join('\n');
            expect(parseYamlDescription(fm)).toBe(
                'Remove signs of AI-generated writing.\nBased on Wikipedia guide.'
            );
        });

        it('parses block folded (>) multiline description', () => {
            const fm = [
                'name: test',
                'description: >',
                '  This is a long',
                '  description that folds.',
            ].join('\n');
            expect(parseYamlDescription(fm)).toBe(
                'This is a long description that folds.'
            );
        });

        it('handles strip chomping indicator (|-)', () => {
            const fm = [
                'description: |-',
                '  Stripped trailing newline.',
            ].join('\n');
            expect(parseYamlDescription(fm)).toBe('Stripped trailing newline.');
        });

        it('handles keep chomping indicator (|+)', () => {
            const fm = [
                'description: |+',
                '  Keep trailing newline.',
            ].join('\n');
            expect(parseYamlDescription(fm)).toBe('Keep trailing newline.');
        });

        it('stops collecting at non-indented line', () => {
            const fm = [
                'description: |',
                '  First line.',
                '  Second line.',
                'version: 1.0',
            ].join('\n');
            expect(parseYamlDescription(fm)).toBe('First line.\nSecond line.');
        });

        it('returns undefined for empty block scalar', () => {
            const fm = [
                'description: |',
                'version: 1.0',
            ].join('\n');
            expect(parseYamlDescription(fm)).toBeUndefined();
        });

        it('returns undefined when no description field', () => {
            expect(parseYamlDescription('name: test\nversion: 1.0')).toBeUndefined();
        });

        it('handles CRLF line endings', () => {
            const fm = 'description: |\r\n  Line one.\r\n  Line two.\r\nversion: 1.0';
            expect(parseYamlDescription(fm)).toBe('Line one.\nLine two.');
        });
    });

    // ── parseSkillMd with block scalar ───────────────────────

    describe('parseSkillMd with block scalar description', () => {
        it('parses frontmatter with block literal description', () => {
            const md = [
                '---',
                'name: humanizer',
                'version: 2.2.0',
                'description: |',
                '  Remove signs of AI-generated writing from text.',
                '  Use when editing or reviewing text.',
                '---',
                '',
                '# Humanizer',
            ].join('\n');

            const result = parseSkillMd(md);
            expect(result.description).toBe(
                'Remove signs of AI-generated writing from text.\nUse when editing or reviewing text.'
            );
            expect(result.version).toBe('2.2.0');
            expect(result.promptBody).toContain('# Humanizer');
        });

        it('parses frontmatter with block folded description', () => {
            const md = [
                '---',
                'description: >',
                '  A long description',
                '  that gets folded.',
                '---',
                '',
                'Body text.',
            ].join('\n');

            const result = parseSkillMd(md);
            expect(result.description).toBe('A long description that gets folded.');
        });
    });

    // ── extractDescriptionFromMarkdown with block scalar ─────

    describe('extractDescriptionFromMarkdown with block scalar', () => {
        it('extracts block literal description from frontmatter', () => {
            const md = [
                '---',
                'description: |',
                '  Multi-line description.',
                '  Second line.',
                '---',
                '# Heading',
            ].join('\n');
            expect(extractDescriptionFromMarkdown(md)).toBe(
                'Multi-line description.\nSecond line.'
            );
        });
    });

    // ── extractDescriptionFromMarkdown ───────────────────────

    describe('extractDescriptionFromMarkdown', () => {
        it('extracts from frontmatter description field', () => {
            const md = '---\ndescription: From FM\n---\n# Heading\nBody';
            expect(extractDescriptionFromMarkdown(md)).toBe('From FM');
        });

        it('extracts first non-heading line when no frontmatter', () => {
            expect(extractDescriptionFromMarkdown('# Title\nSome text')).toBe('Some text');
        });

        it('truncates long descriptions to 100 chars', () => {
            const long = 'A'.repeat(150);
            const result = extractDescriptionFromMarkdown(long);
            expect(result).toBe('A'.repeat(97) + '...');
        });

        it('returns undefined for empty content', () => {
            expect(extractDescriptionFromMarkdown('')).toBeUndefined();
        });

        it('skips headings, fences, and delimiters', () => {
            const md = '# H1\n---\n```code```\nActual desc';
            expect(extractDescriptionFromMarkdown(md)).toBe('Actual desc');
        });
    });

    // ── listDirectoryFiles ───────────────────────────────────

    describe('listDirectoryFiles', () => {
        it('returns sorted file names', () => {
            fs.writeFileSync(path.join(tmpDir, 'b.txt'), '');
            fs.writeFileSync(path.join(tmpDir, 'a.txt'), '');
            fs.mkdirSync(path.join(tmpDir, 'subdir'));
            const files = listDirectoryFiles(tmpDir);
            expect(files).toEqual(['a.txt', 'b.txt']);
        });

        it('returns empty array for non-existent path', () => {
            expect(listDirectoryFiles(path.join(tmpDir, 'nope'))).toEqual([]);
        });
    });

    // ── listInstalledSkills ──────────────────────────────────

    describe('listInstalledSkills', () => {
        it('lists skills with SKILL.md', () => {
            const skillDir = path.join(tmpDir, 'my-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(
                path.join(skillDir, 'SKILL.md'),
                '---\ndescription: Hello\nversion: 1.0\n---\nBody',
            );

            const skills = listInstalledSkills(tmpDir);
            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe('my-skill');
            expect(skills[0].description).toBe('Hello');
        });

        it('skips directories without SKILL.md', () => {
            fs.mkdirSync(path.join(tmpDir, 'no-skill'));
            expect(listInstalledSkills(tmpDir)).toHaveLength(0);
        });

        it('returns empty for non-existent path', () => {
            expect(listInstalledSkills(path.join(tmpDir, 'missing'))).toEqual([]);
        });
    });

    // ── getSkillDetail ───────────────────────────────────────

    describe('getSkillDetail', () => {
        it('returns skill detail with references and scripts', () => {
            const skillDir = path.join(tmpDir, 'detail-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: Detailed\n---\n');
            const refsDir = path.join(skillDir, 'references');
            fs.mkdirSync(refsDir);
            fs.writeFileSync(path.join(refsDir, 'ref.md'), '');
            const scriptsDir = path.join(skillDir, 'scripts');
            fs.mkdirSync(scriptsDir);
            fs.writeFileSync(path.join(scriptsDir, 'run.sh'), '');

            const skill = getSkillDetail(tmpDir, 'detail-skill');
            expect(skill).not.toBeNull();
            expect(skill!.name).toBe('detail-skill');
            expect(skill!.description).toBe('Detailed');
            expect(skill!.references).toEqual(['ref.md']);
            expect(skill!.scripts).toEqual(['run.sh']);
        });

        it('returns null when SKILL.md missing', () => {
            fs.mkdirSync(path.join(tmpDir, 'empty'));
            expect(getSkillDetail(tmpDir, 'empty')).toBeNull();
        });
    });

    // ── SkillInfo type ───────────────────────────────────────

    describe('SkillInfo type', () => {
        it('accepts both relativePath and source fields', () => {
            const skill: SkillInfo = {
                name: 'test',
                relativePath: '.github/skills/test',
                source: 'global',
            };
            expect(skill.name).toBe('test');
            expect(skill.relativePath).toBe('.github/skills/test');
            expect(skill.source).toBe('global');
        });
    });
});
