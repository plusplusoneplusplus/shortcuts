/**
 * Unit tests for the Phase 2 gitInfo preservation logic in ReposContext.
 *
 * Phase 1 of fetchRepos() seeds each repo with gitInfo: { isGitRepo: !!ws.isGitRepo }
 * so the Git and Pull Requests tabs appear immediately. Phase 2 fetches richer git
 * details via a batch API call per agent, then merges the results.
 *
 * The bug: when a batch request failed (e.g., due to a double-nested URL), the
 * merged map was empty, and the update set gitInfo to `undefined`, discarding the
 * Phase 1 isGitRepo flag and hiding the tabs.
 *
 * The fix: fall back to the existing gitInfo (r.gitInfo) when the batch result for
 * a workspace is absent, so Phase 1's isGitRepo is preserved.
 */

import { describe, expect, it } from 'vitest';

// ── Replica of the exact mapping expression used in ReposContext.tsx Phase 2 ──
// Keep in sync with:
//   packages/coc/src/server/spa/client/react/contexts/ReposContext.tsx
//   setRepos(prev => prev.map(r => ({
//     ...r,
//     gitInfo: merged[r.workspace.id] || r.gitInfo || undefined,
//     gitInfoLoading: false,
//   })));

function applyPhase2Update(
    prev: Array<{ workspace: { id: string }; gitInfo: any; gitInfoLoading: boolean }>,
    merged: Record<string, any>,
) {
    return prev.map(r => ({
        ...r,
        gitInfo: merged[r.workspace.id] || r.gitInfo || undefined,
        gitInfoLoading: false,
    }));
}

// ── helpers ─────────────────────────────────────────────────────────────────

function makeRepo(id: string, gitInfo: any, loading = true) {
    return { workspace: { id }, gitInfo, gitInfoLoading: loading };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('ReposContext Phase 2 gitInfo fallback', () => {
    it('uses batch result when present, overwriting Phase 1 placeholder', () => {
        const prev = [makeRepo('ws1', { isGitRepo: true, branch: null, dirty: false })];
        const merged = { ws1: { isGitRepo: true, branch: 'main', dirty: true, ahead: 2, behind: 0 } };

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfo).toEqual({ isGitRepo: true, branch: 'main', dirty: true, ahead: 2, behind: 0 });
        expect(result[0].gitInfoLoading).toBe(false);
    });

    it('preserves Phase 1 gitInfo when batch result is absent (agent request failed)', () => {
        // This is the regression: before the fix, gitInfo was set to undefined when
        // merged[wsId] was missing, hiding the Git and Pull Requests tabs.
        const prev = [makeRepo('ws1', { isGitRepo: true, branch: null, dirty: false })];
        const merged: Record<string, any> = {}; // empty — agent returned no results

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfo).toEqual({ isGitRepo: true, branch: null, dirty: false });
        expect(result[0].gitInfo?.isGitRepo).toBe(true); // NOT undefined → tabs still visible
    });

    it('preserves isGitRepo: false from Phase 1 when batch is empty', () => {
        const prev = [makeRepo('ws1', { isGitRepo: false })];
        const merged: Record<string, any> = {};

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfo?.isGitRepo).toBe(false);
    });

    it('handles mixed repos: some get batch results, others fall back to Phase 1', () => {
        const prev = [
            makeRepo('ws-git', { isGitRepo: true, branch: null, dirty: false }),
            makeRepo('ws-bare', { isGitRepo: false }),
        ];
        // ws-git gets a full batch result; ws-bare's agent failed
        const merged = {
            'ws-git': { isGitRepo: true, branch: 'feature', dirty: true, ahead: 0, behind: 0 },
        };

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfo).toEqual({ isGitRepo: true, branch: 'feature', dirty: true, ahead: 0, behind: 0 });
        expect(result[1].gitInfo?.isGitRepo).toBe(false); // preserved from Phase 1
    });

    it('falls back to undefined when Phase 1 gitInfo is also absent', () => {
        const prev = [makeRepo('ws1', undefined)];
        const merged: Record<string, any> = {};

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfo).toBeUndefined();
    });

    it('marks gitInfoLoading: false regardless of whether batch result is present', () => {
        const prev = [
            makeRepo('ws1', { isGitRepo: true }),
            makeRepo('ws2', { isGitRepo: false }),
        ];
        const merged = { ws1: { isGitRepo: true, branch: 'main' } }; // ws2 absent

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfoLoading).toBe(false);
        expect(result[1].gitInfoLoading).toBe(false);
    });

    it('batch null result (server returned null for wsId) falls back to Phase 1', () => {
        // Server can return { results: { wsId: null } } when workspace is unknown.
        // null is falsy, so merged[wsId] || r.gitInfo preserves Phase 1.
        const prev = [makeRepo('ws1', { isGitRepo: true, branch: null, dirty: false })];
        const merged = { ws1: null };

        const result = applyPhase2Update(prev, merged);

        expect(result[0].gitInfo?.isGitRepo).toBe(true);
    });
});
