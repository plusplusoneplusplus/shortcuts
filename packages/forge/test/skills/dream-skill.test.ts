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
        expect(analyzer).toContain('{{dreamCardCategories}}');
    });

    it('critic section does not require analyzer category substitution', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        const critic = extractSkillSection(content, 'critic');
        expect(critic.trim()).not.toBe('');
        expect(critic).not.toContain('{{dreamCardCategories}}');
    });

    it('keeps the analyzer output fields consumed by candidate normalization', () => {
        const analyzer = extractSkillSection(fs.readFileSync(SKILL_FILE, 'utf8'), 'analyzer');
        for (const field of ['candidates', 'category', 'sourceRanges', 'processId', 'startTurnIndex',
            'endTurnIndex', 'observedPattern', 'whyItMatters', 'recommendation', 'expectedImpact',
            'confidence', 'notAlreadyCoveredRationale']) {
            expect(analyzer).toMatch(new RegExp(`"${field}"\\s*:`));
        }
    });

    it('keeps the critic output fields and verdict values consumed by its parser', () => {
        const critic = extractSkillSection(fs.readFileSync(SKILL_FILE, 'utf8'), 'critic');
        for (const field of ['decisions', 'candidateIndex', 'verdict', 'rationale', 'dedupRationale', 'duplicateOfCardId']) {
            expect(critic).toMatch(new RegExp(`"${field}"\\s*:`));
        }
        for (const verdict of ['accept', 'reject', 'duplicate']) {
            expect(critic).toContain(`"${verdict}"`);
        }
    });
});
