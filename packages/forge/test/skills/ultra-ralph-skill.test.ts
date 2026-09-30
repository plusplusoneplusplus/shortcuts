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
        expect(content).toContain('version: "0.1.2"');
    });

    it('defines RALPH_NEXT and RALPH_COMPLETE in terms of autonomous work', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('Emit RALPH_NEXT only when a specific autonomous subtask remains');
        expect(content).toContain('Remaining: manual verification only');
        expect(content).toContain('human-only verification');
    });

    it('restricts RALPH_NEEDS_INPUT to one structured batch for critical blockers', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('Human input is a last resort');
        expect(content).toContain('a conflict with a `[decision]` item');
        expect(content).toContain('a destructive or irreversible action');
        expect(content).toContain('missing credentials or external access');
        expect(content).toContain('a product choice that cannot be inferred and would be costly to redo');
        expect(content).toContain('tag it `[assumption]`');
        expect(content).toContain('Keep interruptions to a minimum');
        expect(content).toContain('`RALPH_NEEDS_INPUT` as `<SIGNAL>`');
        expect(content).toContain('Ask at most five questions');
        expect(content).toContain('never emit more than one question batch');
    });
});
