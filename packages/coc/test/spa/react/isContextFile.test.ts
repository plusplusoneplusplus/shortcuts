/**
 * Tests for isContextFile utility and CONTEXT_FILES set.
 */

import { describe, it, expect } from 'vitest';
import { isContextFile, CONTEXT_FILES } from '../../../src/server/spa/client/react/hooks/useTaskTree';

describe('isContextFile', () => {
    it('returns true for README.md (case-insensitive)', () => {
        expect(isContextFile('README.md')).toBe(true);
        expect(isContextFile('readme.md')).toBe(true);
        expect(isContextFile('Readme.md')).toBe(true);
    });

    it('returns true for CLAUDE.md', () => {
        expect(isContextFile('CLAUDE.md')).toBe(true);
        expect(isContextFile('claude.md')).toBe(true);
    });

    it('returns true for LICENSE (with and without extension)', () => {
        expect(isContextFile('LICENSE')).toBe(true);
        expect(isContextFile('license')).toBe(true);
        expect(isContextFile('LICENSE.md')).toBe(true);
        expect(isContextFile('license.md')).toBe(true);
    });

    it('returns true for CHANGELOG.md', () => {
        expect(isContextFile('CHANGELOG.md')).toBe(true);
    });

    it('returns true for CONTRIBUTING.md', () => {
        expect(isContextFile('CONTRIBUTING.md')).toBe(true);
    });

    it('returns true for CODE_OF_CONDUCT.md', () => {
        expect(isContextFile('CODE_OF_CONDUCT.md')).toBe(true);
    });

    it('returns true for SECURITY.md', () => {
        expect(isContextFile('SECURITY.md')).toBe(true);
    });

    it('returns true for index and index.md', () => {
        expect(isContextFile('index')).toBe(true);
        expect(isContextFile('INDEX')).toBe(true);
        expect(isContextFile('index.md')).toBe(true);
    });

    it('returns true for context and context.md', () => {
        expect(isContextFile('context')).toBe(true);
        expect(isContextFile('context.md')).toBe(true);
    });

    it('returns true for .gitignore', () => {
        expect(isContextFile('.gitignore')).toBe(true);
    });

    it('returns true for .gitattributes', () => {
        expect(isContextFile('.gitattributes')).toBe(true);
    });

    it('returns false for regular task files', () => {
        expect(isContextFile('task1.md')).toBe(false);
        expect(isContextFile('feature.plan.md')).toBe(false);
        expect(isContextFile('implementation.spec.md')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isContextFile('')).toBe(false);
    });
});

describe('CONTEXT_FILES set', () => {
    it('contains expected number of entries', () => {
        expect(CONTEXT_FILES.size).toBeGreaterThanOrEqual(14);
    });

    it('all entries are lowercase', () => {
        for (const entry of CONTEXT_FILES) {
            expect(entry).toBe(entry.toLowerCase());
        }
    });
});
