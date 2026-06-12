/**
 * Tests for the `## Section:` extractor used by multi-section bundled skills.
 */

import { describe, it, expect } from 'vitest';
import { extractSkillSection, SkillSectionNotFoundError } from '../../src/skills/skill-section';

const SAMPLE = [
    '---',
    'name: sample',
    '---',
    '',
    '# Intro prose (not a section header).',
    '',
    '## Section: alpha',
    '',
    'Alpha body line one.',
    'Alpha body line two.',
    '',
    '## Section: beta',
    '',
    'Beta body.',
    '',
].join('\n');

describe('extractSkillSection', () => {
    it('extracts the body between a header and the next header, trimmed', () => {
        expect(extractSkillSection(SAMPLE, 'alpha')).toBe('Alpha body line one.\nAlpha body line two.');
    });

    it('extracts the last section up to end of file', () => {
        expect(extractSkillSection(SAMPLE, 'beta')).toBe('Beta body.');
    });

    it('matches the section name exactly after trimming', () => {
        expect(extractSkillSection('## Section:   alpha  \n\nbody\n', 'alpha')).toBe('body');
    });

    it('normalizes CRLF line endings', () => {
        const crlf = '## Section: alpha\r\n\r\nbody line\r\n';
        expect(extractSkillSection(crlf, 'alpha')).toBe('body line');
    });

    it('does not treat a mid-paragraph "## Section:" mention as a header', () => {
        const content = '## Section: alpha\n\nWe document the `## Section: beta` convention here.\n';
        expect(extractSkillSection(content, 'alpha')).toBe('We document the `## Section: beta` convention here.');
    });

    it('throws SkillSectionNotFoundError for a missing section', () => {
        expect(() => extractSkillSection(SAMPLE, 'missing')).toThrow(SkillSectionNotFoundError);
    });
});
