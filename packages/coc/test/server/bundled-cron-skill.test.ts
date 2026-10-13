/**
 * Tests for the bundled /cron skill registration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getBundledSkillsPath } from '@plusplusoneplusplus/forge';

describe('bundled cron skill', () => {
    it('SKILL.md contains expected frontmatter name', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('name: cron');
    });
});
