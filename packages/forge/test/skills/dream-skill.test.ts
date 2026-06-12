/**
 * Tests for the `dream` bundled skill file presence and section structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BUNDLED_SKILLS_REGISTRY } from '../../src/skills/bundled-skills-registry';
import { extractSkillSection } from '../../src/skills/skill-section';

const SKILL_FILE = path.resolve(__dirname, '../../resources/bundled-skills/dream/SKILL.md');

describe('dream bundled skill', () => {
    it('is registered in BUNDLED_SKILLS_REGISTRY', () => {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === 'dream');
        expect(entry).toBeDefined();
        expect(entry?.relativePath).toBe('dream');
    });

    it('SKILL.md file exists on disk', () => {
        expect(fs.existsSync(SKILL_FILE)).toBe(true);
    });

    it('has YAML frontmatter with name dream', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('name: dream');
    });

    it('contains the analyzer and critic sections', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('## Section: analyzer');
        expect(content).toContain('## Section: critic');
    });

    it('analyzer section keeps the dreamCardCategories placeholder', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        const analyzer = extractSkillSection(content, 'analyzer');
        expect(analyzer).toContain('You are the CoC Dream analyzer.');
        expect(analyzer).toContain('{{dreamCardCategories}}');
    });

    it('critic section holds the critic system prompt verbatim', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        const critic = extractSkillSection(content, 'critic');
        expect(critic).toContain('You are the CoC Dream critic and dedup validator.');
        expect(critic).not.toContain('{{dreamCardCategories}}');
    });
});
