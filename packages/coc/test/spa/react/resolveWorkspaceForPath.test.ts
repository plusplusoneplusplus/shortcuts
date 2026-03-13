/**
 * Tests for resolveWorkspaceForPath — case-insensitive workspace matching and
 * no silent wrong-workspace fallback.
 */

import { describe, it, expect } from 'vitest';
import { resolveWorkspaceForPath, type WorkspaceLike } from '../../../src/server/spa/client/react/App';

const ws1: WorkspaceLike = { id: 'ws-a', rootPath: '/home/user/Repo-A' };
const ws2: WorkspaceLike = { id: 'ws-b', rootPath: '/home/user/Repo-B' };
const workspaces: WorkspaceLike[] = [ws1, ws2];

describe('resolveWorkspaceForPath', () => {
    // ── Happy path ──────────────────────────────────────────────────────

    it('returns the matching workspace for an exact root path', () => {
        expect(resolveWorkspaceForPath('/home/user/Repo-A', workspaces)).toBe(ws1);
    });

    it('returns the matching workspace for a file inside the root', () => {
        expect(resolveWorkspaceForPath('/home/user/Repo-B/src/index.ts', workspaces)).toBe(ws2);
    });

    it('picks the deeper (more specific) workspace when roots share a prefix', () => {
        const parent: WorkspaceLike = { id: 'ws-parent', rootPath: '/projects' };
        const child: WorkspaceLike = { id: 'ws-child', rootPath: '/projects/sub' };
        expect(resolveWorkspaceForPath('/projects/sub/file.ts', [parent, child])).toBe(child);
    });

    // ── Case-insensitive matching (Windows / macOS) ──────────────────────

    it('matches when file path casing differs from rootPath casing', () => {
        // AI may emit lowercase; rootPath stored in original casing
        expect(resolveWorkspaceForPath('/home/user/repo-a/file.ts', workspaces)).toBe(ws1);
    });

    it('matches when rootPath casing differs from file path casing', () => {
        const ws: WorkspaceLike = { id: 'ws-mixed', rootPath: '/Home/User/MyProject' };
        expect(resolveWorkspaceForPath('/home/user/myproject/src/main.ts', [ws])).toBe(ws);
    });

    it('matches with backslash-style Windows paths', () => {
        const ws: WorkspaceLike = { id: 'ws-win', rootPath: 'C:\\Users\\Dev\\MyRepo' };
        expect(resolveWorkspaceForPath('C:/Users/Dev/MyRepo/src/app.ts', [ws])).toBe(ws);
    });

    it('is case-insensitive for Windows paths', () => {
        const ws: WorkspaceLike = { id: 'ws-win', rootPath: 'C:\\Users\\Dev\\MyRepo' };
        expect(resolveWorkspaceForPath('c:/users/dev/myrepo/file.ts', [ws])).toBe(ws);
    });

    // ── No silent fallback ────────────────────────────────────────────────

    it('returns null when no workspace matches (not workspace[0])', () => {
        expect(resolveWorkspaceForPath('/unrelated/path/file.ts', workspaces)).toBeNull();
    });

    it('returns null for empty workspaces array', () => {
        expect(resolveWorkspaceForPath('/home/user/Repo-A/file.ts', [])).toBeNull();
    });

    it('returns null when all workspaces have no rootPath', () => {
        const ws: WorkspaceLike = { id: 'ws-no-root' };
        expect(resolveWorkspaceForPath('/any/path/file.ts', [ws])).toBeNull();
    });

    // ── Edge cases ────────────────────────────────────────────────────────

    it('does not match a path that is merely a prefix of the root (no trailing slash)', () => {
        // '/home/user/Repo' must NOT match ws with root '/home/user/Repo-B'
        const ws: WorkspaceLike = { id: 'ws-long', rootPath: '/home/user/Repo-B' };
        expect(resolveWorkspaceForPath('/home/user/Repo', [ws])).toBeNull();
    });

    it('handles trailing slash on rootPath gracefully', () => {
        const ws: WorkspaceLike = { id: 'ws-slash', rootPath: '/home/user/Repo-A/' };
        expect(resolveWorkspaceForPath('/home/user/Repo-A/src/app.ts', [ws])).toBe(ws);
    });

    it('returns the workspace for an exact path match (file === root)', () => {
        const ws: WorkspaceLike = { id: 'ws-exact', rootPath: '/projects/exact' };
        expect(resolveWorkspaceForPath('/projects/exact', [ws])).toBe(ws);
    });
});
