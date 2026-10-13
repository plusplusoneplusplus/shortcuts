/**
 * Tests for the bundled grill-me skill registration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getBundledSkillsPath, parseBundledSkillVersion } from '@plusplusoneplusplus/forge';

describe('bundled grill-me skill', () => {
    const skillPath = path.join(getBundledSkillsPath(), 'grill-me', 'SKILL.md');

    it('has a parseable semver version in its frontmatter', () => {
        const version = parseBundledSkillVersion('grill-me');
        expect(version).toBeDefined();
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('keeps the decision tags recognized by Ralph title extraction', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('[decision]');
        expect(content).toContain('[assumption]');
        expect(content).toContain('[open]');
    });

    it('keeps the goal heading consumed by Ralph promotion', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('## Goal');
    });
});
