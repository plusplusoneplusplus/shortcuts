/**
 * Tests for the bundled trace-callstack skill registration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    getBundledSkillsPath,
    getBundledSkillsRegistry,
    parseBundledSkillVersion,
} from '@plusplusoneplusplus/forge';
import { DEFAULT_BUNDLED_SKILLS } from '../../src/config';

describe('bundled trace-callstack skill', () => {
    const skillPath = path.join(getBundledSkillsPath(), 'trace-callstack', 'SKILL.md');

    it('has a SKILL.md file in the bundled-skills directory', () => {
        expect(fs.existsSync(skillPath)).toBe(true);
    });

    it('is registered in the bundled-skills registry', () => {
        const entry = getBundledSkillsRegistry().find(s => s.name === 'trace-callstack');
        expect(entry).toBeDefined();
        expect(entry?.relativePath).toBe('trace-callstack');
    });

    it('is included in DEFAULT_BUNDLED_SKILLS for auto-install', () => {
        expect(DEFAULT_BUNDLED_SKILLS).toContain('trace-callstack');
    });

    it('has a matching name and a parseable semver version in its frontmatter', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/^---\r?\nname: trace-callstack\r?\n/);
        expect(parseBundledSkillVersion('trace-callstack')).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('SKILL.md defines the linked tree format and big-tree handling', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('## Output Format');
        expect(content).toContain('called at');
        expect(content).toContain('## Big Trees');
        expect(content).toContain('Expand next');
    });
});
