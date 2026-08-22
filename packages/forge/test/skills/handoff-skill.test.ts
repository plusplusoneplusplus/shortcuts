/**
 * Tests for the `handoff` bundled skill file presence and content.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BUNDLED_SKILLS_REGISTRY } from '../../src/skills/bundled-skills-registry';

const SKILL_FILE = path.resolve(__dirname, '../../resources/bundled-skills/handoff/SKILL.md');

describe('handoff bundled skill', () => {
    it('is registered in BUNDLED_SKILLS_REGISTRY', () => {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === 'handoff');
        expect(entry).toBeDefined();
        expect(entry?.relativePath).toBe('handoff');
    });

    it('SKILL.md file exists on disk', () => {
        expect(fs.existsSync(SKILL_FILE)).toBe(true);
    });

    it('has YAML frontmatter with name, description and a parsable version', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('name: handoff');
        expect(content).toContain('description: Compact the current conversation into a handoff document for another agent to pick up.');
        expect(content).toMatch(/version:\s*"0\.0\.1"/);
    });

    it('keeps the upstream invocation flags', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('argument-hint: "What will the next session be used for?"');
        expect(content).toContain('disable-model-invocation: true');
    });

    it('credits the upstream source', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        expect(content).toContain('author: Matt Pocock');
        expect(content).toContain('source: https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md');
    });

    it('carries the upstream instructions verbatim', () => {
        const content = fs.readFileSync(SKILL_FILE, 'utf8');
        const body = content.split('---')[2] ?? '';
        expect(body).toContain(
            "Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace."
        );
        expect(body).toContain(
            'Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.'
        );
        expect(body).toContain(
            'Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.'
        );
        expect(body).toContain(
            'Redact any sensitive information, such as API keys, passwords, or personally identifiable information.'
        );
        expect(body).toContain(
            'If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.'
        );
    });
});
