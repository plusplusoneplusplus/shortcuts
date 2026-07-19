// @vitest-environment jsdom
/**
 * AC-03 of preserve-explorer-state (unit): the per-workspace "unsaved explorer
 * edits" registry and the workspace-switch guard that prompts before discarding
 * them. Covers instance-level dirty tracking (independent siblings + workspaces),
 * clearing, and the confirm/cancel semantics of the switch guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    setExplorerInstanceDirty,
    isExplorerDirty,
    clearExplorerDirty,
    confirmDiscardExplorerEditsOnSwitch,
    EXPLORER_UNSAVED_SWITCH_MESSAGE,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

beforeEach(() => {
    clearExplorerDirty();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('explorerDirtyStore — dirty registry (AC-03)', () => {
    it('reports clean for an unknown / empty workspace', () => {
        expect(isExplorerDirty('ws-1')).toBe(false);
        expect(isExplorerDirty(null)).toBe(false);
        expect(isExplorerDirty(undefined)).toBe(false);
    });

    it('marks a workspace dirty while any instance is dirty, clean once all clear', () => {
        setExplorerInstanceDirty('ws-1', 'inst-a', true);
        expect(isExplorerDirty('ws-1')).toBe(true);

        setExplorerInstanceDirty('ws-1', 'inst-a', false);
        expect(isExplorerDirty('ws-1')).toBe(false);
    });

    it('keeps a workspace dirty when one of several instances clears (no clobber)', () => {
        setExplorerInstanceDirty('ws-1', 'inst-a', true);
        setExplorerInstanceDirty('ws-1', 'inst-b', true);
        // One sibling reporting clean must not drop the workspace's dirty state.
        setExplorerInstanceDirty('ws-1', 'inst-b', false);
        expect(isExplorerDirty('ws-1')).toBe(true);
        setExplorerInstanceDirty('ws-1', 'inst-a', false);
        expect(isExplorerDirty('ws-1')).toBe(false);
    });

    it('tracks workspaces independently', () => {
        setExplorerInstanceDirty('ws-1', 'inst-a', true);
        expect(isExplorerDirty('ws-1')).toBe(true);
        expect(isExplorerDirty('ws-2')).toBe(false);
    });

    it('clearExplorerDirty(ws) resets one workspace; clearExplorerDirty() resets all', () => {
        setExplorerInstanceDirty('ws-1', 'inst-a', true);
        setExplorerInstanceDirty('ws-2', 'inst-b', true);
        clearExplorerDirty('ws-1');
        expect(isExplorerDirty('ws-1')).toBe(false);
        expect(isExplorerDirty('ws-2')).toBe(true);
        clearExplorerDirty();
        expect(isExplorerDirty('ws-2')).toBe(false);
    });
});

describe('confirmDiscardExplorerEditsOnSwitch — workspace-switch guard (AC-03)', () => {
    it('allows the switch without prompting when the source is clean', () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        expect(confirmDiscardExplorerEditsOnSwitch('ws-1', 'ws-2')).toBe(true);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('allows (no prompt) when there is no source workspace or it is unchanged', () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        setExplorerInstanceDirty('ws-1', 'inst-a', true);
        expect(confirmDiscardExplorerEditsOnSwitch(null, 'ws-2')).toBe(true);
        // Same workspace (e.g. a sub-tab route) is never a discard.
        expect(confirmDiscardExplorerEditsOnSwitch('ws-1', 'ws-1')).toBe(true);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(isExplorerDirty('ws-1')).toBe(true);
    });

    it('prompts when the source is dirty and, on confirm, clears the flag and allows the switch', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        setExplorerInstanceDirty('ws-1', 'inst-a', true);

        expect(confirmDiscardExplorerEditsOnSwitch('ws-1', 'ws-2')).toBe(true);
        expect(confirmSpy).toHaveBeenCalledWith(EXPLORER_UNSAVED_SWITCH_MESSAGE);
        // Discard confirmed → the workspace is no longer dirty.
        expect(isExplorerDirty('ws-1')).toBe(false);
    });

    it('prompts when the source is dirty and, on cancel, keeps the flag and blocks the switch', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        setExplorerInstanceDirty('ws-1', 'inst-a', true);

        expect(confirmDiscardExplorerEditsOnSwitch('ws-1', 'ws-2')).toBe(false);
        expect(confirmSpy).toHaveBeenCalledWith(EXPLORER_UNSAVED_SWITCH_MESSAGE);
        // Cancelled → the dirty buffer is preserved.
        expect(isExplorerDirty('ws-1')).toBe(true);
    });
});
