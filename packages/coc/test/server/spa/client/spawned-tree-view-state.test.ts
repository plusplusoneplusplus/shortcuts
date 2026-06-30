/**
 * @vitest-environment jsdom
 *
 * Tests for spawned-tree-view-state — the localStorage-backed feature toggle
 * (default ON) and per-root collapse persistence (default expanded) for the
 * spawned-conversation tree.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    isSpawnedTreeViewEnabled,
    setSpawnedTreeViewEnabled,
    loadCollapsedSpawnedRootIds,
    persistCollapsedSpawnedRootIds,
    toggleCollapsedSpawnedRoot,
} from '../../../../src/server/spa/client/react/features/chat/spawned-tree-view-state';

const TOGGLE_KEY = 'coc-spawned-tree-enabled';
const COLLAPSED_KEY = 'coc-spawned-tree-collapsed';

beforeEach(() => {
    localStorage.clear();
});

describe('feature toggle', () => {
    it('defaults ON when nothing is persisted', () => {
        expect(isSpawnedTreeViewEnabled()).toBe(true);
    });

    it('stays ON for any value other than the explicit "false"', () => {
        localStorage.setItem(TOGGLE_KEY, 'true');
        expect(isSpawnedTreeViewEnabled()).toBe(true);
        localStorage.setItem(TOGGLE_KEY, 'garbage');
        expect(isSpawnedTreeViewEnabled()).toBe(true);
    });

    it('turns OFF only when explicitly disabled, and round-trips', () => {
        setSpawnedTreeViewEnabled(false);
        expect(localStorage.getItem(TOGGLE_KEY)).toBe('false');
        expect(isSpawnedTreeViewEnabled()).toBe(false);
        setSpawnedTreeViewEnabled(true);
        expect(isSpawnedTreeViewEnabled()).toBe(true);
    });
});

describe('collapsed-root persistence', () => {
    it('loads an empty set when nothing is persisted (default expanded)', () => {
        expect(loadCollapsedSpawnedRootIds().size).toBe(0);
    });

    it('persists and reloads a collapsed-root set', () => {
        persistCollapsedSpawnedRootIds(new Set(['root-1', 'root-2']));
        const loaded = loadCollapsedSpawnedRootIds();
        expect([...loaded].sort()).toEqual(['root-1', 'root-2']);
    });

    it('tolerates malformed / non-array JSON by returning an empty set', () => {
        localStorage.setItem(COLLAPSED_KEY, '{not valid');
        expect(loadCollapsedSpawnedRootIds().size).toBe(0);
        localStorage.setItem(COLLAPSED_KEY, '{"a":1}');
        expect(loadCollapsedSpawnedRootIds().size).toBe(0);
    });

    it('drops non-string / empty entries on load', () => {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['ok', '', 3, null]));
        expect([...loadCollapsedSpawnedRootIds()]).toEqual(['ok']);
    });

    it('toggle adds then removes a root, persisting each time, without mutating the input', () => {
        const initial = new Set<string>();
        const collapsed = toggleCollapsedSpawnedRoot(initial, 'root-1');
        expect(initial.size).toBe(0); // input untouched
        expect(collapsed.has('root-1')).toBe(true);
        expect(loadCollapsedSpawnedRootIds().has('root-1')).toBe(true);

        const expanded = toggleCollapsedSpawnedRoot(collapsed, 'root-1');
        expect(expanded.has('root-1')).toBe(false);
        expect(loadCollapsedSpawnedRootIds().has('root-1')).toBe(false);
    });
});
