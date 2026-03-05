/**
 * Tests for ReposGrid localStorage persistence helpers.
 * Covers group collapse state persisted across sidebar toggle / page refresh.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadGroupExpandedState,
    saveGroupExpandedState,
} from '../../../../src/server/spa/client/react/repos/ReposGrid';

const KEY = 'coc-git-group-expanded-state';

describe('loadGroupExpandedState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns empty object when localStorage has no entry', () => {
        expect(loadGroupExpandedState()).toEqual({});
    });

    it('returns parsed state when a valid JSON entry exists', () => {
        const stored = { 'github.com/user/repo': false, 'github.com/other/repo': true };
        localStorage.setItem(KEY, JSON.stringify(stored));
        expect(loadGroupExpandedState()).toEqual(stored);
    });

    it('returns empty object when localStorage entry is invalid JSON', () => {
        localStorage.setItem(KEY, 'not-json}}}');
        expect(loadGroupExpandedState()).toEqual({});
    });
});

describe('saveGroupExpandedState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('writes state to localStorage as JSON', () => {
        const state = { 'github.com/user/repo': false };
        saveGroupExpandedState(state);
        expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(state);
    });

    it('overwrites a previous entry', () => {
        saveGroupExpandedState({ 'github.com/a': false });
        saveGroupExpandedState({ 'github.com/b': false });
        expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ 'github.com/b': false });
    });
});

describe('round-trip: save then load', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('survives a save/load cycle (collapsed group)', () => {
        const state = { 'github.com/user/repo': false };
        saveGroupExpandedState(state);
        expect(loadGroupExpandedState()).toEqual(state);
    });

    it('survives a save/load cycle with multiple groups', () => {
        const state: Record<string, boolean> = {
            'github.com/a/repo': false,
            'github.com/b/repo': true,
            'github.com/c/repo': false,
        };
        saveGroupExpandedState(state);
        expect(loadGroupExpandedState()).toEqual(state);
    });

    it('default expanded (true) is preserved when explicitly stored', () => {
        const state = { 'github.com/x/repo': true };
        saveGroupExpandedState(state);
        const loaded = loadGroupExpandedState();
        expect(loaded['github.com/x/repo']).toBe(true);
    });

    it('state is keyed per group — one group does not affect another', () => {
        const state = { 'github.com/a': false, 'github.com/b': true };
        saveGroupExpandedState(state);
        const loaded = loadGroupExpandedState();
        expect(loaded['github.com/a']).toBe(false);
        expect(loaded['github.com/b']).toBe(true);
    });
});
