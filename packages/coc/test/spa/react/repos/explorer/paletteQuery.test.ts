/**
 * The palette's prefix grammar (AC-05).
 *
 * The dialog is awkward to drive and the grammar is where the edge cases live,
 * so the rules are pinned here as pure input/output: which prefixes switch
 * mode, which ones are just text, and what a `:N` query means.
 */
import { describe, expect, it } from 'vitest';
import {
    matchesKindFilter,
    parsePaletteQuery,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/paletteQuery';

describe('parsePaletteQuery', () => {
    it('falls back to the mode the dialog was opened in', () => {
        expect(parsePaletteQuery('quick', 'files')).toEqual({ mode: 'files', term: 'quick' });
        expect(parsePaletteQuery('quick', 'symbols')).toEqual({ mode: 'symbols', term: 'quick' });
    });

    it('switches to files on `f `, keeping the term', () => {
        expect(parsePaletteQuery('f quick', 'symbols')).toMatchObject({ mode: 'files', term: 'quick' });
    });

    it('restricts to types on `t ` and to members on `m `', () => {
        expect(parsePaletteQuery('t Explorer', 'files')).toMatchObject({
            mode: 'symbols', kindFilter: 'types', term: 'Explorer',
        });
        expect(parsePaletteQuery('m render', 'files')).toMatchObject({
            mode: 'symbols', kindFilter: 'members', term: 'render',
        });
    });

    it('names the active filter, so the mode is never invisible', () => {
        expect(parsePaletteQuery('t x', 'files').filterLabel).toBe('Types');
        expect(parsePaletteQuery('m x', 'files').filterLabel).toBe('Members');
        expect(parsePaletteQuery('f x', 'symbols').filterLabel).toBe('Files');
        expect(parsePaletteQuery('x', 'symbols').filterLabel).toBeUndefined();
    });

    it('treats a bare prefix letter as a search term, so a symbol named `f` is findable', () => {
        expect(parsePaletteQuery('f', 'symbols')).toEqual({ mode: 'symbols', term: 'f' });
        expect(parsePaletteQuery('t', 'symbols')).toEqual({ mode: 'symbols', term: 't' });
        expect(parsePaletteQuery('fwc', 'symbols')).toEqual({ mode: 'symbols', term: 'fwc' });
    });

    it('backspacing the prefix restores the opening mode', () => {
        expect(parsePaletteQuery('f quick', 'symbols').mode).toBe('files');
        expect(parsePaletteQuery('fquick', 'symbols').mode).toBe('symbols');
    });

    it('reads `:N` as a line target without leaving the current mode', () => {
        expect(parsePaletteQuery(':120', 'symbols')).toMatchObject({
            mode: 'symbols', lineTarget: 120, term: '',
        });
        expect(parsePaletteQuery(':120', 'files').lineTarget).toBe(120);
        // Not a line target: a colon followed by anything else is a search.
        expect(parsePaletteQuery(':abc', 'files').lineTarget).toBeUndefined();
        expect(parsePaletteQuery('::', 'files').lineTarget).toBeUndefined();
    });

    it('an empty prefix body is an empty term, not the prefix text', () => {
        expect(parsePaletteQuery('t ', 'files')).toMatchObject({ kindFilter: 'types', term: '' });
    });
});

describe('matchesKindFilter', () => {
    it('keeps everything without a filter', () => {
        expect(matchesKindFilter(12, undefined)).toBe(true);
        expect(matchesKindFilter(5, undefined)).toBe(true);
    });

    it('keeps type-like kinds under `t ` and member-like kinds under `m `', () => {
        for (const kind of [5, 10, 11, 23]) {
            expect(matchesKindFilter(kind, 'types')).toBe(true);
            expect(matchesKindFilter(kind, 'members')).toBe(false);
        }
        for (const kind of [6, 7, 8, 9, 12]) {
            expect(matchesKindFilter(kind, 'members')).toBe(true);
            expect(matchesKindFilter(kind, 'types')).toBe(false);
        }
    });
});
