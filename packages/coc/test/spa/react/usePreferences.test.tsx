import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePreferences } from '../../../src/server/spa/client/react/hooks/usePreferences';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

describe('usePreferences', () => {
    describe('with repoId', () => {
        it('loads model from GET /api/workspaces/:id/preferences (lastModels)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastModels: { task: 'gpt-4', ask: 'claude-3' } }),
            });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.models.task).toBe('gpt-4');
                expect(result.current.models.ask).toBe('claude-3');
                expect(result.current.models.plan).toBe('');
                // backward compat: model returns task model
                expect(result.current.model).toBe('gpt-4');
            });

            expect(mockFetch.mock.calls[0][0]).toContain('/workspaces/my-repo/preferences');
        });

        it('falls back to lastModel for all modes when lastModels is absent', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastModel: 'gpt-4' }),
            });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.models.task).toBe('gpt-4');
                expect(result.current.models.ask).toBe('gpt-4');
                expect(result.current.models.plan).toBe('gpt-4');
            });
        });

        it('defaults to empty string when API fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.models.task).toBe('');
                expect(result.current.models.ask).toBe('');
            });
        });

        it('setModel updates model state for the given mode immediately', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastModels: { task: 'gpt-4' } }),
            });
            // PATCH call
            mockFetch.mockResolvedValueOnce({ ok: true });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setModel('task', 'gpt-3.5');
            });

            expect(result.current.models.task).toBe('gpt-3.5');
        });

        it('setModel fires PATCH /api/workspaces/:id/preferences with lastModels', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastModels: { task: '' } }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setModel('ask', 'claude-3');
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([url, opts]: [string, any]) => opts?.method === 'PATCH' && url.includes('/workspaces/')
                );
                expect(patchCalls.length).toBe(1);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastModels).toEqual({ ask: 'claude-3' });
            });
        });

        // -- depth support --

        it('loads depth from GET /api/workspaces/:id/preferences', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastModel: 'gpt-4', lastDepth: 'normal' }),
            });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.depth).toBe('normal');
            });
        });

        it('defaults depth to empty string when API fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.depth).toBe('');
            });
        });

        it('setDepth updates depth state immediately', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastDepth: 'deep' }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setDepth('normal');
            });

            expect(result.current.depth).toBe('normal');
        });

        it('setDepth fires PATCH /api/workspaces/:id/preferences with lastDepth', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastDepth: 'deep' }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setDepth('normal');
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([url, opts]: [string, any]) => opts?.method === 'PATCH' && url.includes('/workspaces/')
                );
                expect(patchCalls.length).toBe(1);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastDepth).toBe('normal');
            });
        });

        // -- skill support (per-mode) --

        it('loads skills from GET /api/workspaces/:id/preferences', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastSkills: { task: 'impl', ask: 'go-deep' } }),
            });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.skills.task).toBe('impl');
                expect(result.current.skills.ask).toBe('go-deep');
                expect(result.current.skills.plan).toBe('');
            });
        });

        it('defaults skills to empty strings when API fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
                expect(result.current.skills).toEqual({ task: '', ask: '', plan: '' });
            });
        });

        it('setSkill updates skill state for the given mode immediately', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastSkills: { task: 'impl' } }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setSkill('task', 'go-deep');
            });

            expect(result.current.skills.task).toBe('go-deep');
        });

        it('setSkill fires PATCH /api/workspaces/:id/preferences with lastSkills', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ lastSkills: {} }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true });

            const { result } = renderHook(() => usePreferences('my-repo'));

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setSkill('ask', 'impl');
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([url, opts]: [string, any]) => opts?.method === 'PATCH' && url.includes('/workspaces/')
                );
                expect(patchCalls.length).toBe(1);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastSkills).toEqual({ ask: 'impl' });
            });
        });

        it('re-fetches when repoId changes', async () => {
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ lastModels: { task: 'model-a' } }) })
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ lastModels: { task: 'model-b' } }) });

            const { result, rerender } = renderHook(({ id }) => usePreferences(id), {
                initialProps: { id: 'repo-a' },
            });

            await waitFor(() => {
                expect(result.current.models.task).toBe('model-a');
            });

            rerender({ id: 'repo-b' });

            await waitFor(() => {
                expect(result.current.models.task).toBe('model-b');
            });

            expect(mockFetch.mock.calls[1][0]).toContain('/workspaces/repo-b/preferences');
        });
    });

    describe('without repoId', () => {
        it('returns loaded=true immediately without fetching', async () => {
            const { result } = renderHook(() => usePreferences());

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('returns empty defaults without fetching', async () => {
            const { result } = renderHook(() => usePreferences());

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            expect(result.current.model).toBe('');
            expect(result.current.models).toEqual({ task: '', ask: '', plan: '' });
            expect(result.current.depth).toBe('');
            expect(result.current.effort).toBe('');
            expect(result.current.skills).toEqual({ task: '', ask: '', plan: '' });
        });

        it('setModel updates local state but does not persist', async () => {
            const { result } = renderHook(() => usePreferences());

            await waitFor(() => {
                expect(result.current.loaded).toBe(true);
            });

            act(() => {
                result.current.setModel('task', 'gpt-4');
            });

            expect(result.current.models.task).toBe('gpt-4');
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
