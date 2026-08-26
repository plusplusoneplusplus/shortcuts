/**
 * Tests for explorerStateStore — per-workspace, localStorage-backed persistence
 * of the File Explorer's UI state (expanded paths + selected/open preview file).
 *
 * These guard AC-01 of preserve-explorer-state: state survives a remount
 * (workspace switch) and a reload, keyed per workspace, and each workspace's
 * state is independent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    explorerExpandedStorageKey,
    explorerSelectedStorageKey,
    explorerPreviewStorageKey,
    useExplorerExpandedPaths,
    useExplorerSelectedPath,
    useExplorerPreviewFile,
    explorerViewStorageKey,
    explorerContentQueryStorageKey,
    explorerContentModesStorageKey,
    useExplorerView,
    useExplorerContentQuery,
    useExplorerContentModes,
    useExplorerContentResults,
    clearExplorerContentResults,
    IDLE_CONTENT_SEARCH_STATE,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

beforeEach(() => {
    localStorage.clear();
});

describe('explorerStateStore — storage keys', () => {
    it('scopes keys per workspace under the split-workspace convention', () => {
        expect(explorerExpandedStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-expanded');
        expect(explorerSelectedStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-selected');
        expect(explorerPreviewStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-preview');
    });

    it('produces distinct keys for distinct workspaces', () => {
        expect(explorerExpandedStorageKey('a')).not.toBe(explorerExpandedStorageKey('b'));
    });
});

describe('useExplorerExpandedPaths', () => {
    it('starts empty when nothing is persisted', () => {
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        expect(result.current[0]).toBeInstanceOf(Set);
        expect(result.current[0].size).toBe(0);
    });

    it('persists to localStorage as a JSON array under the per-workspace key', () => {
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => result.current[1](new Set(['src', 'src/components'])));
        expect(result.current[0]).toEqual(new Set(['src', 'src/components']));
        const raw = localStorage.getItem(explorerExpandedStorageKey('ws-1'));
        expect(JSON.parse(raw!)).toEqual(['src', 'src/components']);
    });

    it('supports functional updater form like useState', () => {
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => result.current[1](new Set(['src'])));
        act(() => result.current[1](prev => {
            const next = new Set(prev);
            next.add('docs');
            return next;
        }));
        expect(result.current[0]).toEqual(new Set(['src', 'docs']));
    });

    it('shares state across two hook instances for the same workspace', () => {
        const a = renderHook(() => useExplorerExpandedPaths('ws-1'));
        const b = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => a.result.current[1](new Set(['src'])));
        expect(b.result.current[0]).toEqual(new Set(['src']));
    });

    it('keeps distinct workspaces independent', () => {
        const a = renderHook(() => useExplorerExpandedPaths('ws-a'));
        const b = renderHook(() => useExplorerExpandedPaths('ws-b'));
        act(() => a.result.current[1](new Set(['src'])));
        expect(a.result.current[0]).toEqual(new Set(['src']));
        expect(b.result.current[0].size).toBe(0);
    });

    it('restores from pre-seeded localStorage (simulates a reload)', () => {
        localStorage.setItem(explorerExpandedStorageKey('ws-1'), JSON.stringify(['a', 'a/b']));
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        expect(result.current[0]).toEqual(new Set(['a', 'a/b']));
    });

    it('falls back to empty on malformed persisted JSON', () => {
        localStorage.setItem(explorerExpandedStorageKey('ws-1'), '{not json');
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        expect(result.current[0].size).toBe(0);
    });

    it('returns a referentially-stable value across re-renders when unchanged', () => {
        const { result, rerender } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => result.current[1](new Set(['src'])));
        const first = result.current[0];
        rerender();
        expect(result.current[0]).toBe(first);
    });
});

describe('useExplorerSelectedPath', () => {
    it('starts null and round-trips through localStorage', () => {
        const { result } = renderHook(() => useExplorerSelectedPath('ws-1'));
        expect(result.current[0]).toBeNull();
        act(() => result.current[1]('src/index.ts'));
        expect(result.current[0]).toBe('src/index.ts');
        expect(JSON.parse(localStorage.getItem(explorerSelectedStorageKey('ws-1'))!)).toBe('src/index.ts');
    });

    it('can be cleared back to null', () => {
        const { result } = renderHook(() => useExplorerSelectedPath('ws-1'));
        act(() => result.current[1]('src/index.ts'));
        act(() => result.current[1](null));
        expect(result.current[0]).toBeNull();
    });
});

describe('useExplorerPreviewFile', () => {
    it('starts null and round-trips a preview file', () => {
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        expect(result.current[0]).toBeNull();
        act(() => result.current[1]({ path: 'src/index.ts', name: 'index.ts' }));
        expect(result.current[0]).toEqual({ path: 'src/index.ts', name: 'index.ts' });
    });

    it('restores a preview file from pre-seeded localStorage (reload)', () => {
        localStorage.setItem(
            explorerPreviewStorageKey('ws-1'),
            JSON.stringify({ path: 'a/b.ts', name: 'b.ts' }),
        );
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        expect(result.current[0]).toEqual({ path: 'a/b.ts', name: 'b.ts' });
    });

    it('ignores malformed preview payloads', () => {
        localStorage.setItem(explorerPreviewStorageKey('ws-1'), JSON.stringify({ path: 5 }));
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        expect(result.current[0]).toBeNull();
    });
});


// ---------------------------------------------------------------------------
// AC-04 of repo-content-search: the Search view's own persisted state, plus the
// deliberately in-memory result cache.
// ---------------------------------------------------------------------------

describe('useExplorerView', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to the tree view', () => {
        const { result } = renderHook(() => useExplorerView('ws-1'));
        expect(result.current[0]).toBe('tree');
    });

    it('persists the chosen view per workspace', () => {
        const { result } = renderHook(() => useExplorerView('ws-1'));
        act(() => result.current[1]('search'));
        expect(JSON.parse(localStorage.getItem(explorerViewStorageKey('ws-1'))!)).toBe('search');
        expect(renderHook(() => useExplorerView('ws-2')).result.current[0]).toBe('tree');
    });

    it('falls back to the tree view for an unrecognised stored value', () => {
        localStorage.setItem(explorerViewStorageKey('ws-1'), JSON.stringify('nonsense'));
        expect(renderHook(() => useExplorerView('ws-1')).result.current[0]).toBe('tree');
    });
});

describe('useExplorerContentQuery', () => {
    beforeEach(() => localStorage.clear());

    it('starts empty and persists what is typed', () => {
        const { result } = renderHook(() => useExplorerContentQuery('ws-1'));
        expect(result.current[0]).toBe('');
        act(() => result.current[1]('needle'));
        expect(JSON.parse(localStorage.getItem(explorerContentQueryStorageKey('ws-1'))!)).toBe('needle');
    });

    it('ignores a non-string stored value', () => {
        localStorage.setItem(explorerContentQueryStorageKey('ws-1'), JSON.stringify(7));
        expect(renderHook(() => useExplorerContentQuery('ws-1')).result.current[0]).toBe('');
    });
});

describe('useExplorerContentModes', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to case-insensitive, not whole-word, literal', () => {
        const { result } = renderHook(() => useExplorerContentModes('ws-1'));
        expect(result.current[0]).toEqual({ caseSensitive: false, wholeWord: false, regex: false });
    });

    it('returns a stable reference across renders so effects do not re-fire', () => {
        const { result, rerender } = renderHook(() => useExplorerContentModes('ws-1'));
        const first = result.current[0];
        rerender();
        expect(result.current[0]).toBe(first);

        act(() => result.current[1](prev => ({ ...prev, regex: true })));
        const afterWrite = result.current[0];
        rerender();
        expect(result.current[0]).toBe(afterWrite);
    });

    it('persists each toggle independently', () => {
        const { result } = renderHook(() => useExplorerContentModes('ws-1'));
        act(() => result.current[1](prev => ({ ...prev, wholeWord: true })));
        expect(JSON.parse(localStorage.getItem(explorerContentModesStorageKey('ws-1'))!))
            .toEqual({ caseSensitive: false, wholeWord: true, regex: false });
    });

    it('coerces a partial or malformed stored object to explicit booleans', () => {
        localStorage.setItem(explorerContentModesStorageKey('ws-1'), JSON.stringify({ regex: 'yes' }));
        expect(renderHook(() => useExplorerContentModes('ws-1')).result.current[0])
            .toEqual({ caseSensitive: false, wholeWord: false, regex: false });
    });
});

describe('useExplorerContentResults', () => {
    beforeEach(() => {
        localStorage.clear();
        clearExplorerContentResults();
    });

    it('starts idle', () => {
        expect(renderHook(() => useExplorerContentResults('ws-1')).result.current[0])
            .toBe(IDLE_CONTENT_SEARCH_STATE);
    });

    it('shares results across two consumers of the same workspace', () => {
        const a = renderHook(() => useExplorerContentResults('ws-1'));
        const b = renderHook(() => useExplorerContentResults('ws-1'));
        act(() => a.result.current[1]({ ...IDLE_CONTENT_SEARCH_STATE, status: 'empty', query: 'x' }));
        expect(b.result.current[0].status).toBe('empty');
    });

    it('keeps workspaces independent', () => {
        const a = renderHook(() => useExplorerContentResults('ws-1'));
        const b = renderHook(() => useExplorerContentResults('ws-2'));
        act(() => a.result.current[1]({ ...IDLE_CONTENT_SEARCH_STATE, status: 'empty' }));
        expect(b.result.current[0].status).toBe('idle');
    });

    it('never touches localStorage — a 500-match payload has no business there', () => {
        const { result } = renderHook(() => useExplorerContentResults('ws-1'));
        act(() => result.current[1]({ ...IDLE_CONTENT_SEARCH_STATE, status: 'empty', query: 'needle' }));
        expect(localStorage.length).toBe(0);
    });

    it('clearExplorerContentResults resets one workspace, or all of them', () => {
        const a = renderHook(() => useExplorerContentResults('ws-1'));
        const b = renderHook(() => useExplorerContentResults('ws-2'));
        act(() => a.result.current[1]({ ...IDLE_CONTENT_SEARCH_STATE, status: 'empty' }));
        act(() => b.result.current[1]({ ...IDLE_CONTENT_SEARCH_STATE, status: 'empty' }));

        act(() => clearExplorerContentResults('ws-1'));
        expect(a.result.current[0].status).toBe('idle');
        expect(b.result.current[0].status).toBe('empty');

        act(() => clearExplorerContentResults());
        expect(b.result.current[0].status).toBe('idle');
    });
});

describe('useExplorerPreviewFile — reveal line', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips the line a content-search hit was opened at', () => {
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        act(() => result.current[1]({ path: 'src/app.ts', name: 'app.ts', line: 17 }));
        expect(renderHook(() => useExplorerPreviewFile('ws-1')).result.current[0])
            .toEqual({ path: 'src/app.ts', name: 'app.ts', line: 17 });
    });

    it('omits the line for a file opened from the tree', () => {
        localStorage.setItem(explorerPreviewStorageKey('ws-1'), JSON.stringify({ path: 'a.ts', name: 'a.ts' }));
        expect(renderHook(() => useExplorerPreviewFile('ws-1')).result.current[0])
            .toEqual({ path: 'a.ts', name: 'a.ts' });
    });

    it('drops a non-numeric stored line rather than passing it to Monaco', () => {
        localStorage.setItem(
            explorerPreviewStorageKey('ws-1'),
            JSON.stringify({ path: 'a.ts', name: 'a.ts', line: 'seventeen' }),
        );
        expect(renderHook(() => useExplorerPreviewFile('ws-1')).result.current[0])
            .toEqual({ path: 'a.ts', name: 'a.ts' });
    });
});
