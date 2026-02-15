/**
 * SPA Dashboard Tests — escapeHtml helper
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml } from './spa-test-helpers';

describe('escapeHtml', () => {
    it('escapes ampersands', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('handles string with no special chars', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('escapes all special chars in one string', () => {
        expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    });
});
