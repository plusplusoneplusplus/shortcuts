/**
 * Tests for the bundled grill-me skill registration.
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

describe('bundled grill-me skill', () => {
    const skillPath = path.join(getBundledSkillsPath(), 'grill-me', 'SKILL.md');

    it('has a SKILL.md file in the bundled-skills directory', () => {
        expect(fs.existsSync(skillPath)).toBe(true);
    });

    it('is registered in the bundled-skills registry', () => {
        const registry = getBundledSkillsRegistry();
        expect(registry.find(s => s.name === 'grill-me')).toBeDefined();
    });

    it('is included in DEFAULT_BUNDLED_SKILLS for auto-install', () => {
        expect(DEFAULT_BUNDLED_SKILLS).toContain('grill-me');
    });

    it('has a parseable semver version in its frontmatter', () => {
        const version = parseBundledSkillVersion('grill-me');
        expect(version).toBeDefined();
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('SKILL.md documents the two-phase grill flow', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('Phase 1');
        expect(content).toContain('Phase 2');
        expect(content).toContain('size threshold');
    });

    it('SKILL.md documents the decision tagging convention', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('[decision]');
        expect(content).toContain('[assumption]');
        expect(content).toContain('[open]');
    });

    it('SKILL.md documents the slice template with Definition of Done', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('## Behavior');
        expect(content).toContain('## Definition of Done');
        expect(content).toContain('ac-NN-<slug>.spec.md');
    });

    it('SKILL.md documents the ready-for-Ralph checklist', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('Ready-for-Ralph Checklist');
        expect(content).toContain('Definition of Done');
    });

    it('SKILL.md documents the synthesis path used by Ralph promotion', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('## Goal');
        expect(content).toContain('grilling');
    });
});
