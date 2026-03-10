import { describe, it, expect } from 'vitest';
import { normalizeLineEndings } from '../../src/utils/normalize-line-endings';

describe('normalizeLineEndings', () => {
    it('converts CRLF to LF', () => {
        expect(normalizeLineEndings('line1\r\nline2\r\n')).toBe('line1\nline2\n');
    });

    it('converts lone CR to LF', () => {
        expect(normalizeLineEndings('line1\rline2\r')).toBe('line1\nline2\n');
    });

    it('leaves LF untouched', () => {
        expect(normalizeLineEndings('line1\nline2\n')).toBe('line1\nline2\n');
    });

    it('handles mixed line endings', () => {
        expect(normalizeLineEndings('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    });

    it('handles empty string', () => {
        expect(normalizeLineEndings('')).toBe('');
    });

    it('handles string with no line endings', () => {
        expect(normalizeLineEndings('no endings here')).toBe('no endings here');
    });
});
