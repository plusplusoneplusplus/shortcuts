/**
 * Tests for useSkillTemplates — persists saved (model, mode, skills) templates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSkillTemplates } from '../../../../src/server/spa/client/react/features/templates/hooks/useSkillTemplates';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// Mock getApiBase
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
}));

function makePrefsResponse(skillTemplates: any[] = []) {
    return {
        ok: true,
        json: async () => ({ skillTemplates }),
    } as Response;
}

function makePatchResponse() {
    return { ok: true, json: async () => ({}) } as Response;
}

describe('useSkillTemplates', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ── Initial load ──────────────────────────────────────────────

    it('starts with empty templates and loaded=false, then loaded=true after fetch', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        const { result } = renderHook(() => useSkillTemplates('ws1'));

        expect(result.current.loaded).toBe(false);
        expect(result.current.templates).toHaveLength(0);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates).toHaveLength(0);
    });

    it('loads templates from server preferences', async () => {
        const saved = [
            { id: 't1', name: 'task: impl', model: 'claude-sonnet-4.6', mode: 'task', skills: ['impl'] },
            { id: 't2', model: '', mode: 'ask', skills: [] },
        ];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));
        const { result } = renderHook(() => useSkillTemplates('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates).toHaveLength(2);
        expect(result.current.templates[0].id).toBe('t1');
        expect(result.current.templates[0].skills).toEqual(['impl']);
    });

    it('filters out entries with no id', async () => {
        const saved = [
            { id: 't1', model: '', mode: 'ask', skills: [] },
            { model: '', mode: 'task', skills: [] }, // missing id — invalid
        ];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));
        const { result } = renderHook(() => useSkillTemplates('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates).toHaveLength(1);
    });

    it('handles fetch error gracefully — loaded becomes true, templates stays empty', async () => {
        fetchMock.mockRejectedValue(new Error('network error'));
        const { result } = renderHook(() => useSkillTemplates('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates).toHaveLength(0);
    });

    it('handles non-ok fetch response gracefully', async () => {
        fetchMock.mockResolvedValue({ ok: false } as Response);
        const { result } = renderHook(() => useSkillTemplates('ws1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates).toHaveLength(0);
    });

    it('uses global preferences endpoint when wsId is undefined', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        renderHook(() => useSkillTemplates(undefined));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toBe('/preferences');
    });

    it('uses per-workspace preferences endpoint when wsId is provided', async () => {
        fetchMock.mockResolvedValue(makePrefsResponse());
        renderHook(() => useSkillTemplates('my-repo'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain('/workspaces/my-repo/preferences');
    });

    // ── saveTemplate ──────────────────────────────────────────────

    it('saveTemplate prepends a new template and PATCHes the server', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse()) // initial GET
            .mockResolvedValue(makePatchResponse());    // subsequent PATCHes

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => {
            result.current.saveTemplate({ name: 'my template', model: 'claude-opus', mode: 'ask', skills: ['impl'] });
        });

        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].name).toBe('my template');
        expect(result.current.templates[0].model).toBe('claude-opus');
        expect(result.current.templates[0].mode).toBe('ask');
        expect(result.current.templates[0].skills).toEqual(['impl']);
        expect(result.current.templates[0].id).toBeTruthy();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
        expect(patchUrl).toContain('/workspaces/ws1/preferences');
        expect(patchOpts.method).toBe('PATCH');
        const body = JSON.parse(patchOpts.body);
        expect(body.skillTemplates).toHaveLength(1);
        expect(body.skillTemplates[0].name).toBe('my template');
    });

    it('saveTemplate prepends the new template before existing ones', async () => {
        const existing = [{ id: 'old', name: 'old', model: '', mode: 'task' as const, skills: [] }];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(existing))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => {
            result.current.saveTemplate({ name: 'new', model: '', mode: 'ask', skills: [] });
        });

        expect(result.current.templates[0].name).toBe('new');
        expect(result.current.templates[1].id).toBe('old');
    });

    it('saveTemplate assigns a unique id', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse())
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.saveTemplate({ model: '', mode: 'task', skills: [] }); });
        act(() => { result.current.saveTemplate({ model: '', mode: 'ask', skills: [] }); });

        const ids = result.current.templates.map(t => t.id);
        expect(new Set(ids).size).toBe(2);
    });

    // ── deleteTemplate ────────────────────────────────────────────

    it('deleteTemplate removes the template and PATCHes the server', async () => {
        const existing = [
            { id: 'ta', name: 'A', model: '', mode: 'ask' as const, skills: [] },
            { id: 'tb', name: 'B', model: '', mode: 'task' as const, skills: [] },
        ];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(existing))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.deleteTemplate('ta'); });

        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].id).toBe('tb');

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.skillTemplates).toHaveLength(1);
        expect(body.skillTemplates[0].id).toBe('tb');
    });

    it('deleteTemplate is a no-op for unknown id', async () => {
        const existing = [{ id: 'ta', name: 'A', model: '', mode: 'ask' as const, skills: [] }];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(existing))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.deleteTemplate('nonexistent'); });

        expect(result.current.templates).toHaveLength(1);
        // PATCH still fires (idempotent persist)
    });

    it('deleting all templates PATCHes an empty array', async () => {
        const existing = [{ id: 'ta', model: '', mode: 'task' as const, skills: [] }];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(existing))
            .mockResolvedValue(makePatchResponse());

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.deleteTemplate('ta'); });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.skillTemplates).toEqual([]);
    });

    // ── postActions round-trip ────────────────────────────────────

    it('template with postActions round-trips correctly on load', async () => {
        const saved = [{
            id: 'pa-1',
            name: 'with post-actions',
            model: 'claude-sonnet-4.6',
            mode: 'task',
            skills: ['impl'],
            postActions: [
                { type: 'script', script: './deploy.sh' },
                { type: 'skill', skillName: 'review-summary' },
            ],
        }];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].postActions).toHaveLength(2);
        expect(result.current.templates[0].postActions![0]).toEqual({ type: 'script', script: './deploy.sh' });
        expect(result.current.templates[0].postActions![1]).toEqual({ type: 'skill', skillName: 'review-summary' });
    });

    it('saveTemplate persists postActions in the PATCH body', async () => {
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse())  // initial GET
            .mockResolvedValue(makePatchResponse());      // subsequent PATCHes

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => {
            result.current.saveTemplate({
                name: 'new-pa',
                model: '',
                mode: 'task',
                skills: [],
                postActions: [{ type: 'script', script: './test.sh' }],
            });
        });

        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].postActions).toEqual([{ type: 'script', script: './test.sh' }]);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.skillTemplates[0].postActions).toEqual([{ type: 'script', script: './test.sh' }]);
    });

    it('template without postActions has undefined postActions field', async () => {
        const saved = [{ id: 'no-pa', model: '', mode: 'ask', skills: [] }];
        fetchMock.mockResolvedValue(makePrefsResponse(saved));

        const { result } = renderHook(() => useSkillTemplates('ws1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));

        expect(result.current.templates[0].postActions).toBeUndefined();
    });

    // ── wsId change ───────────────────────────────────────────────

    it('resets templates when wsId changes', async () => {
        const t1 = [{ id: 'a', model: '', mode: 'ask' as const, skills: [] }];
        const t2 = [{ id: 'b', model: '', mode: 'task' as const, skills: [] }];
        fetchMock
            .mockResolvedValueOnce(makePrefsResponse(t1))
            .mockResolvedValueOnce(makePrefsResponse(t2));

        const { result, rerender } = renderHook(
            ({ id }) => useSkillTemplates(id),
            { initialProps: { id: 'ws1' } },
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates[0].id).toBe('a');

        rerender({ id: 'ws2' });
        await waitFor(() => expect(result.current.templates[0]?.id).toBe('b'));
        expect(result.current.templates).toHaveLength(1);
    });
});
