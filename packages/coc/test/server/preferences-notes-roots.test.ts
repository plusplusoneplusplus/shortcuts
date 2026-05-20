import { describe, it, expect } from 'vitest';
import { validatePerRepoPreferences } from '../../src/server/preferences-handler';

describe('validatePerRepoPreferences — additionalNotesRoots', () => {
    it('accepts valid roots array', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['docs/notes', 'wiki'] });
        expect(result.additionalNotesRoots).toEqual(['docs/notes', 'wiki']);
    });

    it('normalizes backslashes to forward slashes', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['docs\\notes'] });
        expect(result.additionalNotesRoots).toEqual(['docs/notes']);
    });

    it('strips trailing slashes', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['docs/notes/'] });
        expect(result.additionalNotesRoots).toEqual(['docs/notes']);
    });

    it('deduplicates entries', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['docs', 'docs', 'wiki'] });
        expect(result.additionalNotesRoots).toEqual(['docs', 'wiki']);
    });

    it('enforces max 10 roots', () => {
        const roots = Array.from({ length: 15 }, (_, i) => `root${i}`);
        const result = validatePerRepoPreferences({ additionalNotesRoots: roots });
        expect(result.additionalNotesRoots).toHaveLength(10);
    });

    it('filters out empty strings', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['', 'docs'] });
        expect(result.additionalNotesRoots).toEqual(['docs']);
    });

    it('filters out absolute paths', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['/absolute', 'docs'] });
        expect(result.additionalNotesRoots).toEqual(['docs']);
    });

    it('filters out parent traversal paths', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: ['../outside', 'docs'] });
        expect(result.additionalNotesRoots).toEqual(['docs']);
    });

    it('returns undefined for non-array values', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: 'not-an-array' });
        expect(result.additionalNotesRoots).toBeUndefined();
    });

    it('preserves empty array as explicit clear', () => {
        const result = validatePerRepoPreferences({ additionalNotesRoots: [] });
        expect(result.additionalNotesRoots).toEqual([]);
    });
});
