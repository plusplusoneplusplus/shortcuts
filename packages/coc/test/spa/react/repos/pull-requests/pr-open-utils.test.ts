/**
 * Tests for the pure parsing/matching helpers behind the "Open PR" input
 * on the Pull Requests tab.
 */

import { describe, expect, it } from 'vitest';
import {
    matchWorkspaceForPrUrl,
    normalizeRemoteUrl,
    parsePrInput,
    parsePrUrl,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-open-utils';

describe('parsePrInput', () => {
    it('treats blank input as invalid', () => {
        expect(parsePrInput('').kind).toBe('invalid');
        expect(parsePrInput('   ').kind).toBe('invalid');
    });

    it('parses a bare positive integer as a number', () => {
        expect(parsePrInput('42')).toEqual({ kind: 'number', number: 42 });
        expect(parsePrInput('  7  ')).toEqual({ kind: 'number', number: 7 });
    });

    it('rejects zero and negative numbers', () => {
        expect(parsePrInput('0').kind).toBe('invalid');
        expect(parsePrInput('-3').kind).toBe('invalid');
    });

    it('rejects free-text that is neither a number nor a URL', () => {
        expect(parsePrInput('abc').kind).toBe('invalid');
        expect(parsePrInput('PR-1').kind).toBe('invalid');
    });

    it('parses GitHub PR URLs', () => {
        expect(parsePrInput('https://github.com/acme/web/pull/15')).toEqual({
            kind: 'url',
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
            number: 15,
        });
    });
});

describe('parsePrUrl', () => {
    it('parses a canonical GitHub PR URL', () => {
        expect(parsePrUrl('https://github.com/acme/Web/pull/123')).toEqual({
            kind: 'url',
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
            number: 123,
        });
    });

    it('tolerates trailing slash, query, and fragment', () => {
        expect(parsePrUrl('https://github.com/acme/web/pull/9/?tab=files#diff-1').number).toBe(9);
    });

    it('accepts the /pulls/ alias', () => {
        const r = parsePrUrl('https://github.com/acme/web/pulls/3');
        expect(r.kind === 'url' && r.number).toBe(3);
    });

    it('rejects non-PR URLs', () => {
        expect(parsePrUrl('https://github.com/acme/web').kind).toBe('invalid');
        expect(parsePrUrl('https://github.com/acme/web/issues/1').kind).toBe('invalid');
    });

    it('rejects URLs missing a number', () => {
        expect(parsePrUrl('https://github.com/acme/web/pull/').kind).toBe('invalid');
        expect(parsePrUrl('https://github.com/acme/web/pull/abc').kind).toBe('invalid');
    });

    it('rejects malformed strings', () => {
        expect(parsePrUrl('not-a-url').kind).toBe('invalid');
    });

    it('accepts GitHub Enterprise hosts', () => {
        const r = parsePrUrl('https://ghe.example.com/team/svc/pull/5');
        expect(r.kind === 'url' && r.host).toBe('ghe.example.com');
    });
});

describe('normalizeRemoteUrl', () => {
    it('normalizes https remotes with .git', () => {
        expect(normalizeRemoteUrl('https://github.com/acme/Web.git')).toEqual({
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
        });
    });

    it('normalizes https remotes without .git', () => {
        expect(normalizeRemoteUrl('https://github.com/acme/web')).toEqual({
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
        });
    });

    it('normalizes scp-style ssh remotes', () => {
        expect(normalizeRemoteUrl('git@github.com:acme/web.git')).toEqual({
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
        });
    });

    it('normalizes ssh:// remotes', () => {
        expect(normalizeRemoteUrl('ssh://git@github.com/acme/web.git')).toEqual({
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
        });
    });

    it('normalizes git+ssh:// remotes', () => {
        expect(normalizeRemoteUrl('git+ssh://git@github.com/acme/web.git')).toEqual({
            host: 'github.com',
            owner: 'acme',
            repo: 'web',
        });
    });

    it('returns null for null/blank/garbage input', () => {
        expect(normalizeRemoteUrl(null)).toBeNull();
        expect(normalizeRemoteUrl('')).toBeNull();
        expect(normalizeRemoteUrl('   ')).toBeNull();
        expect(normalizeRemoteUrl('not a url')).toBeNull();
    });

    it('returns null for URLs without an owner/repo path', () => {
        expect(normalizeRemoteUrl('https://github.com/onlyone')).toBeNull();
    });
});

describe('matchWorkspaceForPrUrl', () => {
    const workspaces = [
        { id: 'ws-a', remoteUrl: 'https://github.com/acme/web.git' },
        { id: 'ws-b', remoteUrl: 'git@github.com:acme/API.git' },
        { id: 'ws-c', remoteUrl: undefined },
    ];

    it('matches an https workspace remote against an https PR URL', () => {
        const parsed = parsePrUrl('https://github.com/acme/web/pull/1');
        expect(parsed.kind).toBe('url');
        if (parsed.kind !== 'url') return;
        expect(matchWorkspaceForPrUrl(workspaces, parsed)?.id).toBe('ws-a');
    });

    it('matches an ssh workspace remote against an https PR URL (case-insensitive)', () => {
        const parsed = parsePrUrl('https://github.com/acme/api/pull/2');
        expect(parsed.kind).toBe('url');
        if (parsed.kind !== 'url') return;
        expect(matchWorkspaceForPrUrl(workspaces, parsed)?.id).toBe('ws-b');
    });

    it('returns null when no workspace matches', () => {
        const parsed = parsePrUrl('https://github.com/unknown/repo/pull/3');
        if (parsed.kind !== 'url') return;
        expect(matchWorkspaceForPrUrl(workspaces, parsed)).toBeNull();
    });

    it('returns null on empty/missing workspace list', () => {
        const parsed = parsePrUrl('https://github.com/acme/web/pull/1');
        if (parsed.kind !== 'url') return;
        expect(matchWorkspaceForPrUrl([], parsed)).toBeNull();
        expect(matchWorkspaceForPrUrl(undefined, parsed)).toBeNull();
    });
});
