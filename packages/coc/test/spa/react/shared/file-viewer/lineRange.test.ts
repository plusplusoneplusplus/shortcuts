/**
 * Tests for the shared file-viewer line helpers (`toLines`, `resolveLineRange`).
 *
 * These moved out of SourceCanvasBody so both the chat canvas and the Explorer
 * preview can resolve a `:line` / `:start-end` reference the same way. The
 * behaviour they encode is asserted end-to-end in SourceCanvasBody.test.tsx;
 * this file pins the pure edges that are awkward to reach through a component.
 */

import { describe, it, expect } from 'vitest';
import { toLines, resolveLineRange } from '../../../../../src/server/spa/client/react/shared/file-viewer/lineRange';

describe('toLines', () => {
    it('splits on newlines', () => {
        expect(toLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
    });

    it('normalises CRLF', () => {
        expect(toLines('a\r\nb')).toEqual(['a', 'b']);
    });

    it('drops a single trailing newline', () => {
        expect(toLines('a\nb\n')).toEqual(['a', 'b']);
    });

    it('keeps a blank line that is not the trailing newline', () => {
        expect(toLines('a\n\nb\n')).toEqual(['a', '', 'b']);
    });

    it('treats empty content as one empty line', () => {
        expect(toLines('')).toEqual(['']);
    });
});

describe('resolveLineRange', () => {
    it('returns null when no line was referenced', () => {
        expect(resolveLineRange(undefined, undefined, 10)).toBeNull();
    });

    it('returns null for a non-positive line', () => {
        expect(resolveLineRange(0, undefined, 10)).toBeNull();
        expect(resolveLineRange(-4, undefined, 10)).toBeNull();
    });

    it('returns null for an empty file', () => {
        expect(resolveLineRange(3, undefined, 0)).toBeNull();
    });

    it('makes a single line a one-line range', () => {
        expect(resolveLineRange(4, undefined, 10)).toEqual({ start: 4, end: 4 });
    });

    it('keeps a start-end range', () => {
        expect(resolveLineRange(2, 5, 10)).toEqual({ start: 2, end: 5 });
    });

    it('clamps a start past the end of the file to the last line', () => {
        expect(resolveLineRange(99, undefined, 10)).toEqual({ start: 10, end: 10 });
    });

    it('clamps an end past the end of the file', () => {
        expect(resolveLineRange(8, 99, 10)).toEqual({ start: 8, end: 10 });
    });

    it('collapses an end before the start to a single line', () => {
        expect(resolveLineRange(6, 2, 10)).toEqual({ start: 6, end: 6 });
    });
});
