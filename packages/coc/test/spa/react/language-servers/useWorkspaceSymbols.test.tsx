// @vitest-environment jsdom
/**
 * The palette's attachment lifetime and derived status (AC-01, AC-06, AC-07).
 *
 * Two things here are worth a test rather than a comment. Attachments outlive
 * keystrokes but not the dialog — leaking one leaks a language-server session
 * per open — and no more than `MAX_CONCURRENT_MEMBERS` repos are ever attached
 * at once. And "Indexing…" is derived from the live session state, so a repo
 * that finishes indexing becomes results without the user retyping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const attached: FakeAttachment[] = [];
const querySpy = vi.fn();

class FakeAttachment {
    released = 0;
    statusListeners = new Set<() => void>();
    infos: unknown[] = [];

    constructor(readonly workspaceId: string) { attached.push(this); }
    getInfos() { return this.infos; }
    getUnavailable() { return null; }
    onStatus(listener: () => void) {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }
    onAttached() { return () => {}; }
    release() { this.released += 1; }
    /** What the host does when a session changes state. */
    setInfos(infos: unknown[]) {
        this.infos = infos;
        for (const listener of [...this.statusListeners]) listener();
    }
}

vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient', () => ({
    getLanguageServerClient: (workspaceId: string) => ({
        attachWorkspace: () => new FakeAttachment(workspaceId),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/workspaceSymbols', async () => {
    const actual = await vi.importActual<Record<string, unknown>>(
        '../../../../src/server/spa/client/react/features/language-servers/workspaceSymbols',
    );
    return { ...actual, queryWorkspaceSymbols: (...args: unknown[]) => querySpy(...args) };
});

import { useWorkspaceSymbols } from '../../../../src/server/spa/client/react/features/language-servers/useWorkspaceSymbols';

function readyInfo(status = 'ready') {
    return {
        attachmentId: 'a', sessionKey: 's', documentUri: 'coc-file://ws/', languageId: 'cpp',
        definitionId: 'coc-symbols', displayName: 'Symbols',
        state: { status, definitionId: 'coc-symbols', displayName: 'Symbols' },
    };
}

beforeEach(() => {
    attached.length = 0;
    querySpy.mockReset();
    querySpy.mockResolvedValue({ results: [], status: 'complete' });
});

const members = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ workspaceId: `ws-${i}` }));

describe('useWorkspaceSymbols', () => {
    it('attaches once for the dialog and releases every view when it closes', async () => {
        const { rerender } = renderHook(
            ({ open }) => useWorkspaceSymbols({ open, members: members(2), query: '', debounceMs: 0, limit: 50 }),
            { initialProps: { open: true } },
        );
        expect(attached).toHaveLength(2);

        rerender({ open: false });
        // Every view released exactly once: a leak here leaks a language-server
        // session per palette open.
        expect(attached.map(view => view.released)).toEqual([1, 1]);

        rerender({ open: true });
        expect(attached).toHaveLength(4);
        expect(attached.slice(2).every(view => view.released === 0)).toBe(true);
    });

    it('never attaches more than the concurrent-member cap', () => {
        renderHook(() => useWorkspaceSymbols({
            open: true, members: members(20), query: '', debounceMs: 0, limit: 50,
        }));
        expect(attached).toHaveLength(6);
    });

    it('attaches nothing while the dialog is closed', () => {
        renderHook(() => useWorkspaceSymbols({
            open: false, members: members(3), query: 'x', debounceMs: 0, limit: 50,
        }));
        expect(attached).toHaveLength(0);
        expect(querySpy).not.toHaveBeenCalled();
    });

    it('runs no query for an empty term', () => {
        renderHook(() => useWorkspaceSymbols({
            open: true, members: members(1), query: '   ', debounceMs: 0, limit: 50,
        }));
        expect(querySpy).not.toHaveBeenCalled();
    });

    it('reports indexing, then results, without a second keystroke', async () => {
        const { result } = renderHook(() => useWorkspaceSymbols({
            open: true, members: members(1), query: 'fwc', debounceMs: 0, limit: 50,
        }));
        act(() => { attached[0].setInfos([readyInfo('indexing')]); });
        await waitFor(() => expect(result.current.indexing).toBe(true));

        querySpy.mockResolvedValue({
            results: [{ name: 'findWorkspaceConfig', kind: 12, path: 'a.cpp', line: 1, col: 1, definitionId: 'coc-symbols' }],
            status: 'complete',
        });
        act(() => { attached[0].setInfos([readyInfo('ready')]); });
        await waitFor(() => {
            expect(result.current.indexing).toBe(false);
            expect(result.current.results).toHaveLength(1);
        });
    });

    it('surfaces the recovery hint when every server is unavailable', async () => {
        const { result } = renderHook(() => useWorkspaceSymbols({
            open: true, members: members(1), query: 'fwc', debounceMs: 0, limit: 50,
        }));
        act(() => {
            attached[0].setInfos([{
                ...readyInfo('unavailable'),
                state: {
                    status: 'unavailable', definitionId: 'coc-symbols', displayName: 'Symbols',
                    detail: 'The bundled symbol index server was not built for this platform.',
                    recoveryCommand: 'npm run build:native -w packages/coc-native',
                },
            }]);
        });
        await waitFor(() => expect(result.current.unavailable).toEqual({
            detail: 'The bundled symbol index server was not built for this platform.',
            recoveryCommand: 'npm run build:native -w packages/coc-native',
        }));
    });
});
