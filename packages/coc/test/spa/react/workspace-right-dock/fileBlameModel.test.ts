import { describe, expect, it } from 'vitest';
import {
    blameRuns,
    mapBlameToBuffer,
    splitBufferLines,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/fileBlameModel';

const head = (...pairs: [string, string][]) => pairs.map(([hash, text]) => ({ hash, text }));

describe('splitBufferLines', () => {
    it('counts lines like git blame', () => {
        expect(splitBufferLines('')).toEqual([]);
        expect(splitBufferLines('a\nb\n')).toEqual(['a', 'b']);
        expect(splitBufferLines('a\r\nb')).toEqual(['a', 'b']);
        expect(splitBufferLines('a\n\n')).toEqual(['a', '']);
    });
});

describe('mapBlameToBuffer', () => {
    const blame = head(['c1', 'one'], ['c2', 'two'], ['c1', 'three']);

    it('attributes every line of an unchanged buffer', () => {
        expect(mapBlameToBuffer(blame, ['one', 'two', 'three'])).toEqual(['c1', 'c2', 'c1']);
    });

    it('marks edited lines as not committed and keeps the rest', () => {
        expect(mapBlameToBuffer(blame, ['one', 'TWO', 'three'])).toEqual(['c1', null, 'c1']);
    });

    it('shifts attribution past inserted lines', () => {
        expect(mapBlameToBuffer(blame, ['new', 'one', 'two', 'extra', 'three'])).toEqual([null, 'c1', 'c2', null, 'c1']);
    });

    it('keeps attribution after deleted lines', () => {
        expect(mapBlameToBuffer(blame, ['one', 'three'])).toEqual(['c1', 'c1']);
    });

    it('never attributes a moved or duplicated line to an obsolete position', () => {
        const result = mapBlameToBuffer(blame, ['three', 'two', 'one']);
        expect(result.filter(hash => hash !== null).length).toBeLessThan(3);
    });

    it('treats every line as not committed when HEAD has no such file', () => {
        expect(mapBlameToBuffer([], ['a', 'b'])).toEqual([null, null]);
    });

    it('matches a final HEAD line whose trailing whitespace the server trimmed', () => {
        expect(mapBlameToBuffer(head(['c1', 'a'], ['c2', 'b']), ['a', 'b  '])).toEqual(['c1', 'c2']);
        expect(mapBlameToBuffer(head(['c1', 'a'], ['c2', 'b']), ['a  ', 'b'])).toEqual([null, 'c2']);
    });

    it('returns nothing for an empty buffer', () => {
        expect(mapBlameToBuffer(blame, [])).toEqual([]);
    });
});

describe('blameRuns', () => {
    it('groups consecutive lines with the same attribution', () => {
        expect(blameRuns(['c1', 'c1', null, null, 'c2', 'c1'])).toEqual([
            { startLine: 1, endLine: 2, hash: 'c1' },
            { startLine: 3, endLine: 4, hash: null },
            { startLine: 5, endLine: 5, hash: 'c2' },
            { startLine: 6, endLine: 6, hash: 'c1' },
        ]);
    });

    it('returns no runs for no lines', () => {
        expect(blameRuns([])).toEqual([]);
    });
});
