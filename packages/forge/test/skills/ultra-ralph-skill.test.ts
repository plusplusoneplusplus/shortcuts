/**
 * Tests for the ultra-ralph bundled skill file presence and section structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BUNDLED_SKILLS_REGISTRY } from '../../src/skills/bundled-skills-registry';
import { extractSkillSection } from '../../src/skills/skill-section';
import { parseRalphNeedsInput } from '@plusplusoneplusplus/coc-workflow/ralph';

const SKILL_FILE = path.resolve(__dirname, '../../resources/bundled-skills/ultra-ralph/SKILL.md');

describe('ultra-ralph bundled skill', () => {
    it('is registered in BUNDLED_SKILLS_REGISTRY', () => {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === 'ultra-ralph');
        expect(entry).toBeDefined();
        expect(entry?.relativePath).toBe('ultra-ralph');
    });

    it('contains the required sections', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        for (const section of ['grill', 'synthesis', 'execution', 'iteration', 'final-check']) {
            expect(extractSkillSection(content, section).trim()).not.toBe('');
        }
    });

    it('has YAML frontmatter with name ultra-ralph', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('name: ultra-ralph');
        expect(content).toContain('version: "0.1.2"');
    });

    it('keeps the goal heading and terminal markers consumed by Ralph', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        for (const section of ['grill', 'synthesis']) {
            expect(extractSkillSection(content, section)).toContain('## Goal');
        }
        const execution = extractSkillSection(content, 'execution');
        for (const signal of ['RALPH_NEXT', 'RALPH_COMPLETE', 'RALPH_NEEDS_INPUT']) {
            expect(execution).toContain(signal);
        }
        // The runtime guard recognizes this journal status, even though it reads like prose.
        expect(execution).toContain('Remaining: manual verification only');
        expect(extractSkillSection(content, 'final-check')).toContain('RALPH_FINAL_CHECK_RESULT');
    });

    it('provides a needs-input example accepted by the runtime parser', () => {
        const execution = extractSkillSection(fs.readFileSync(SKILL_FILE, 'utf8'), 'execution');
        const example = execution.match(/RALPH_NEEDS_INPUT\r?\n```json\r?\n[\s\S]*?\r?\n```/);
        expect(example).toBeTruthy();
        expect(parseRalphNeedsInput(example![0]).status).toBe('ok');
    });
});
