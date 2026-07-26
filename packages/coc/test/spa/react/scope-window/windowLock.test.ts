/**
 * Window-lock enforcement (AC-02) — pure helper tests.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
    parseRepoIdFromHash,
    enforceLockedHash,
} from '../../../../src/server/spa/client/react/features/scope-window/windowLock';

describe('parseRepoIdFromHash', () => {
    it('extracts the scope id from a bare repo route', () => {
        expect(parseRepoIdFromHash('#repos/ws-v2-abc')).toBe('ws-v2-abc');
    });

    it('extracts the scope id from a deep repo route', () => {
        expect(parseRepoIdFromHash('#repos/ws-v2-abc/notes/foo/bar')).toBe('ws-v2-abc');
    });

    it('decodes an encoded segment', () => {
        expect(parseRepoIdFromHash('#repos/my%2Fscope')).toBe('my/scope');
    });

    it('strips a trailing query on the id segment', () => {
        expect(parseRepoIdFromHash('#repos/my_work?foo=1')).toBe('my_work');
    });

    it('returns null for non-repo routes and empty hashes', () => {
        expect(parseRepoIdFromHash('#admin')).toBeNull();
        expect(parseRepoIdFromHash('#wiki')).toBeNull();
        expect(parseRepoIdFromHash('#repos')).toBeNull();
        expect(parseRepoIdFromHash('')).toBeNull();
    });
});

describe('enforceLockedHash', () => {
    it('redirects an empty / top-level hash to the locked scope', () => {
        expect(enforceLockedHash('', 'ws-v2-abc')).toBe('#repos/ws-v2-abc');
        expect(enforceLockedHash('#admin', 'ws-v2-abc')).toBe('#repos/ws-v2-abc');
        expect(enforceLockedHash('#repos', 'ws-v2-abc')).toBe('#repos/ws-v2-abc');
    });

    it('redirects a hash pointing at a different scope back to the locked one', () => {
        expect(enforceLockedHash('#repos/ws-v2-other/git', 'ws-v2-abc')).toBe('#repos/ws-v2-abc');
    });

    it('leaves a hash already on the locked scope untouched (no redirect)', () => {
        expect(enforceLockedHash('#repos/ws-v2-abc', 'ws-v2-abc')).toBeNull();
        expect(enforceLockedHash('#repos/ws-v2-abc/notes/x', 'ws-v2-abc')).toBeNull();
    });

    it('treats virtual scopes identically (AC-04)', () => {
        expect(enforceLockedHash('#admin', 'my_work')).toBe('#repos/my_work');
        expect(enforceLockedHash('#repos/my_work/chats', 'my_work')).toBeNull();
        expect(enforceLockedHash('#repos/my_life', 'my_work')).toBe('#repos/my_work');
    });
});
