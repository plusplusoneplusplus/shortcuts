/**
 * Tests for useGitInfo hook.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'hooks', 'useGitInfo.ts'),
    'utf-8',
);

describe('useGitInfo hook source', () => {
    it('exports useGitInfo as a named function', () => {
        expect(HOOK_SOURCE).toContain('export function useGitInfo');
    });

    it('accepts workspaceId parameter', () => {
        expect(HOOK_SOURCE).toContain('workspaceId: string');
    });

    it('fetches git info through typed workspace client', () => {
        expect(HOOK_SOURCE).toContain('workspaces.gitInfo(workspaceId)');
    });

    it('imports the clone-aware CoC client hook', () => {
        // AC-07: useGitInfo routes via useCocClient(workspaceId) so a remote clone
        // reads git-info from its own server.
        expect(HOOK_SOURCE).toContain("from '../../../repos/cloneRouting'");
        expect(HOOK_SOURCE).toContain('useCocClient');
    });

    it('exports GitInfo interface', () => {
        expect(HOOK_SOURCE).toContain('export interface GitInfo');
    });

    it('GitInfo interface includes ahead and behind fields', () => {
        expect(HOOK_SOURCE).toContain('ahead: number');
        expect(HOOK_SOURCE).toContain('behind: number');
    });

    it('GitInfo interface includes branch, dirty, loading, error fields', () => {
        expect(HOOK_SOURCE).toContain('branch:');
        expect(HOOK_SOURCE).toContain('dirty: boolean');
        expect(HOOK_SOURCE).toContain('loading: boolean');
        expect(HOOK_SOURCE).toContain('error: boolean');
    });

    it('returns ahead: 0 and behind: 0 on error (silent fallback)', () => {
        const catchIdx = HOOK_SOURCE.indexOf('.catch(');
        const catchBlock = HOOK_SOURCE.slice(catchIdx, catchIdx + 200);
        expect(catchBlock).toContain('ahead: 0');
        expect(catchBlock).toContain('behind: 0');
    });

    it('delegates workspaceId encoding to the typed client', () => {
        expect(HOOK_SOURCE).toContain('gitInfo(workspaceId)');
    });

    it('cancels in-flight fetch when workspaceId changes (cleanup)', () => {
        expect(HOOK_SOURCE).toContain('cancelled = true');
    });

    it('reacts to workspaceId changes via useEffect dependency', () => {
        // The clone-aware client is part of the dependency list (workspaceId drives it).
        expect(HOOK_SOURCE).toContain('[workspaceId, client]');
    });
});
