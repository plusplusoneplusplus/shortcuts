/**
 * Tests for auto-folder-utils
 */
import { describe, it, expect } from 'vitest';
import { isValidTaskFolder } from '../../../src/server/executors/auto-folder-utils';

describe('isValidTaskFolder', () => {
    it('returns true for a normal folder name', () => {
        expect(isValidTaskFolder('my-feature')).toBe(true);
    });

    it('returns true for an archive folder (callers handle archive exclusion separately)', () => {
        expect(isValidTaskFolder('archive')).toBe(true);
    });

    it('returns true for a nested path segment that is a normal name', () => {
        expect(isValidTaskFolder('chat-filter')).toBe(true);
    });

    it('returns false for .git', () => {
        expect(isValidTaskFolder('.git')).toBe(false);
    });

    it('returns false for any dot-prefixed hidden directory', () => {
        expect(isValidTaskFolder('.hidden')).toBe(false);
        expect(isValidTaskFolder('.github')).toBe(false);
        expect(isValidTaskFolder('.vscode')).toBe(false);
    });

    it('returns false for a lone dot', () => {
        expect(isValidTaskFolder('.')).toBe(false);
    });
});
