/**
 * Tests for the ultra-ralph bundled skill file presence and section structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BUNDLED_SKILLS_REGISTRY } from '../../src/skills/bundled-skills-registry';

const SKILL_FILE = path.resolve(__dirname, '../../resources/bundled-skills/ultra-ralph/SKILL.md');

describe('ultra-ralph bundled skill', () => {
    it('is registered in BUNDLED_SKILLS_REGISTRY', () => {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === 'ultra-ralph');
        expect(entry).toBeDefined();
        expect(entry?.relativePath).toBe('ultra-ralph');
    });

    it('SKILL.md file exists on disk', () => {
        expect(fs.existsSync(SKILL_FILE)).toBe(true);
    });

    it('contains the required sections', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('## Section: grill');
        expect(content).toContain('## Section: synthesis');
        expect(content).toContain('## Section: execution');
        expect(content).toContain('## Section: iteration');
        expect(content).toContain('## Section: final-check');
    });

    it('has YAML frontmatter with name ultra-ralph', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('name: ultra-ralph');
    });
});
