/**
 * Tests for usePrReviewProgress persistence wiring (AC-04).
 *
 * The in-memory contract is exercised in usePrReviewProgress.test.ts. These
 * tests focus on the AC-04 persistence layer: hydration via GET, debounced
 * PUT on state changes, and stale-head reset behavior.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePrReviewProgress } from '../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress';

// Mock the typed SPA CocClient so the hook hits an in-memory recorder.
type ApiRecord = {
    repoId: string;
    prId: string;
    headSha: string;
    reviewedFiles: string[];
    visitedFiles: string[];
    lastSelectedFile: string | null;
    updatedAt: string;
};

const getReviewProgressForOrigin = vi.fn();
const saveReviewProgressForOrigin = vi.fn();
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        pullRequests: {
            getReviewProgressForOrigin,
            saveReviewProgressForOrigin,
        },
    }),
}));

const KEY = { originId: 'gh_org_repo', workspaceId: 'ws-1', repoId: 'repo', prId: '42' };
const PERSIST_MS = 10;

function mockServer(initial: Partial<ApiRecord> = {}): { store: Map<string, ApiRecord>; putCalls: () => number } {
    const store = new Map<string, ApiRecord>();
    let puts = 0;
    getReviewProgressForOrigin.mockImplementation(async (originId: string, _prId: string, headSha: string, options?: { workspaceId?: string }) => {
        const workspaceId = options?.workspaceId ?? '';
        const found = store.get(`${originId}|${workspaceId}|${headSha}`);
        if (found) return found;
        return {
            repoId: KEY.repoId, prId: KEY.prId, headSha,
            reviewedFiles: [], visitedFiles: [], lastSelectedFile: null,
            updatedAt: new Date(0).toISOString(),
        } satisfies ApiRecord;
    });
    saveReviewProgressForOrigin.mockImplementation(async (
        originId: string,
        _prId: string,
        body: Pick<ApiRecord, 'headSha' | 'reviewedFiles' | 'visitedFiles' | 'lastSelectedFile'>,
        options?: { workspaceId?: string },
    ) => {
        puts++;
        const workspaceId = options?.workspaceId ?? '';
        const rec: ApiRecord = {
            repoId: KEY.repoId,
            prId: KEY.prId,
            headSha: body.headSha,
            reviewedFiles: body.reviewedFiles ?? [],
            visitedFiles: body.visitedFiles ?? [],
            lastSelectedFile: body.lastSelectedFile ?? null,
            updatedAt: new Date().toISOString(),
        };
        store.set(`${originId}|${workspaceId}|${body.headSha}`, rec);
        return rec;
    });
    if (initial.headSha) {
        store.set(`${KEY.originId}|${KEY.workspaceId}|${initial.headSha}`, {
            repoId: KEY.repoId, prId: KEY.prId,
            headSha: initial.headSha,
            reviewedFiles: initial.reviewedFiles ?? [],
            visitedFiles: initial.visitedFiles ?? [],
            lastSelectedFile: initial.lastSelectedFile ?? null,
            updatedAt: new Date().toISOString(),
        });
    }
    return { store, putCalls: () => puts };
}

beforeEach(() => {
    getReviewProgressForOrigin.mockReset();
    saveReviewProgressForOrigin.mockReset();
});
afterEach(() => { vi.clearAllMocks(); });

describe('usePrReviewProgress — persistence (AC-04)', () => {
    it('hydrates visited/reviewed sets from the server on mount', async () => {
        mockServer({
            headSha: 'sha-aaa',
            reviewedFiles: ['a.ts'],
            visitedFiles: ['a.ts', 'b.ts'],
            lastSelectedFile: 'a.ts',
        });
        const { result } = renderHook(() => usePrReviewProgress('sha-aaa', {
            persistence: KEY, persistDebounceMs: PERSIST_MS,
        }));

        await waitFor(() => expect(result.current.state.hydrated).toBe(true));
        expect(result.current.isReviewed('a.ts')).toBe(true);
        expect(result.current.isVisited('a.ts')).toBe(true);
        expect(result.current.isVisited('b.ts')).toBe(true);
    });

    it('does not persist while hydrating', async () => {
        const server = mockServer();
        let resolveGet: (v: unknown) => void = () => {};
        getReviewProgressForOrigin.mockImplementationOnce(() => new Promise(resolve => { resolveGet = resolve; }));

        const { result, unmount } = renderHook(() => usePrReviewProgress('sha-aaa', {
            persistence: KEY, persistDebounceMs: PERSIST_MS,
        }));
        // While hydration is pending, mutations should not trigger a PUT.
        act(() => result.current.markVisited('a.ts'));
        await new Promise(r => setTimeout(r, PERSIST_MS + 5));
        expect(server.putCalls()).toBe(0);

        resolveGet({
            repoId: KEY.repoId, prId: KEY.prId, headSha: 'sha-aaa',
            reviewedFiles: [], visitedFiles: [], lastSelectedFile: null,
            updatedAt: new Date(0).toISOString(),
        });
        unmount();
    });

    it('debounce-persists state changes via PUT', async () => {
        const server = mockServer();
        const { result } = renderHook(() => usePrReviewProgress('sha-aaa', {
            persistence: KEY, persistDebounceMs: PERSIST_MS,
        }));
        await waitFor(() => expect(result.current.state.hydrated).toBe(true));

        act(() => {
            result.current.markVisited('a.ts');
            result.current.markReviewed('b.ts');
        });

        await waitFor(() => expect(server.putCalls()).toBeGreaterThanOrEqual(1), { timeout: 500 });
        // Final stored record contains both changes.
        const stored = Array.from(server.store.values()).pop()!;
        expect(stored.reviewedFiles).toEqual(['b.ts']);
        expect(stored.visitedFiles.sort()).toEqual(['a.ts', 'b.ts']);
    });

    it('stale-head: server returns empty for a different headSha and the hook keeps empty sets', async () => {
        const server = mockServer({
            headSha: 'sha-OLD',
            reviewedFiles: ['old.ts'],
            visitedFiles: ['old.ts'],
        });
        const { result } = renderHook(() => usePrReviewProgress('sha-NEW', {
            persistence: KEY, persistDebounceMs: PERSIST_MS,
        }));
        await waitFor(() => expect(result.current.state.hydrated).toBe(true));
        expect(result.current.state.reviewedFiles.size).toBe(0);
        expect(result.current.state.visitedFiles.size).toBe(0);
        // Server records the new write under sha-NEW only — old.ts stays untouched.
        act(() => result.current.markReviewed('fresh.ts'));
        await waitFor(() => expect(server.putCalls()).toBeGreaterThanOrEqual(1), { timeout: 500 });
        const newRec = server.store.get(`${KEY.originId}|${KEY.workspaceId}|sha-NEW`);
        expect(newRec?.reviewedFiles).toEqual(['fresh.ts']);
        // Old record is preserved server-side untouched.
        const oldRec = server.store.get(`${KEY.originId}|${KEY.workspaceId}|sha-OLD`);
        expect(oldRec?.reviewedFiles).toEqual(['old.ts']);
    });

    it('hook works without persistence options (in-memory only) — no API calls', async () => {
        mockServer();
        const { result } = renderHook(() => usePrReviewProgress('sha-aaa'));
        await waitFor(() => expect(result.current.state.hydrated).toBe(true));
        act(() => result.current.markReviewed('a.ts'));
        expect(result.current.isReviewed('a.ts')).toBe(true);
        // No persistence ⇒ no API contact at all.
        expect(getReviewProgressForOrigin).not.toHaveBeenCalled();
        expect(saveReviewProgressForOrigin).not.toHaveBeenCalled();
    });

    it('survives a transient GET failure: hydrates with empty sets and still allows mutations', async () => {
        getReviewProgressForOrigin.mockRejectedValue(new Error('network down'));
        saveReviewProgressForOrigin.mockResolvedValue({
            repoId: KEY.repoId, prId: KEY.prId, headSha: 'sha-aaa',
            reviewedFiles: [], visitedFiles: [], lastSelectedFile: null,
            updatedAt: new Date().toISOString(),
        });
        const { result } = renderHook(() => usePrReviewProgress('sha-aaa', {
            persistence: KEY, persistDebounceMs: PERSIST_MS,
        }));
        await waitFor(() => expect(result.current.state.hydrated).toBe(true));
        act(() => result.current.markReviewed('a.ts'));
        expect(result.current.isReviewed('a.ts')).toBe(true);
    });

    it('hydrates and persists through origin-scoped client methods', async () => {
        mockServer({
            headSha: 'sha-aaa',
            reviewedFiles: ['a.ts'],
            visitedFiles: ['a.ts'],
        });
        const { result } = renderHook(() => usePrReviewProgress('sha-aaa', {
            persistence: KEY, persistDebounceMs: PERSIST_MS,
        }));
        await waitFor(() => expect(result.current.state.hydrated).toBe(true));
        act(() => result.current.markReviewed('b.ts'));
        await waitFor(() => expect(saveReviewProgressForOrigin).toHaveBeenCalled(), { timeout: 500 });

        expect(getReviewProgressForOrigin).toHaveBeenCalledWith(
            KEY.originId,
            KEY.prId,
            'sha-aaa',
            { workspaceId: KEY.workspaceId, repoId: KEY.repoId },
        );
        expect(saveReviewProgressForOrigin).toHaveBeenCalledWith(
            KEY.originId,
            KEY.prId,
            expect.objectContaining({
                headSha: 'sha-aaa',
                reviewedFiles: expect.arrayContaining(['a.ts', 'b.ts']),
            }),
            { workspaceId: KEY.workspaceId, repoId: KEY.repoId },
        );
    });
});
