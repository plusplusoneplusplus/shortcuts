/**
 * Tests for useCommitListDragController — reorder drag vs. session-context drag.
 *
 * A commit row hosts two native drag sources. These tests pin the boundary:
 * the reorder handle never writes a session-context payload, a context drag
 * passing over the list never becomes a reorder preview, and reorder drops
 * outside the unpushed range are rejected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isSessionContextAttachmentsEnabled: () => true,
}));

import { useCommitListDragController } from '../../../../src/server/spa/client/react/features/git/commits/useCommitListDragController';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';

const mk = (hash: string): GitCommitItem => ({
    hash,
    shortHash: hash.slice(0, 7),
    subject: `subject ${hash}`,
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    parentHashes: [],
});

const A = mk('aaaaaaa1');
const B = mk('bbbbbbb2');
const C = mk('ccccccc3');
const COMMITS = [A, B, C];

/** Minimal DataTransfer stand-in that records every setData call. */
function makeDataTransfer() {
    const data: Record<string, string> = {};
    return {
        data,
        effectAllowed: '' as string,
        dropEffect: '' as string,
        setData: vi.fn((type: string, value: string) => { data[type] = value; }),
        getData: (type: string) => data[type] ?? '',
        types: [] as string[],
    };
}

function makeDragEvent() {
    const dataTransfer = makeDataTransfer();
    return {
        dataTransfer,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as any;
}

const setup = (over: Partial<Parameters<typeof useCommitListDragController>[0]> = {}) => {
    const onReorder = vi.fn();
    const hook = renderHook(() => useCommitListDragController({
        commits: COMMITS,
        unpushedCount: 2,
        sessionContextDragEnabled: true,
        workspaceId: 'ws-1',
        onReorder,
        ...over,
    }));
    return { ...hook, onReorder };
};

beforeEach(() => { vi.clearAllMocks(); });

describe('buildContextPayload', () => {
    it('builds a payload when context drag is enabled and a workspace is known', () => {
        const { result } = setup();
        expect(result.current.buildContextPayload(A)).toMatchObject({ commitHash: A.hash });
    });

    it('returns null when the feature is disabled', () => {
        const { result } = setup({ sessionContextDragEnabled: false });
        expect(result.current.buildContextPayload(A)).toBeNull();
    });

    it('returns null when there is no workspace', () => {
        const { result } = setup({ workspaceId: undefined });
        expect(result.current.buildContextPayload(A)).toBeNull();
    });
});

describe('reorder drag stays separate from context drag', () => {
    it('writes only the index on a reorder drag start, never a context payload', () => {
        const { result } = setup();
        const e = makeDragEvent();
        act(() => { result.current.handleReorderDragStart(e, 1); });

        expect(e.dataTransfer.setData).toHaveBeenCalledTimes(1);
        expect(e.dataTransfer.setData).toHaveBeenCalledWith('text/plain', '1');
        expect(e.dataTransfer.effectAllowed).toBe('move');
        expect(result.current.dragIndex).toBe(1);
    });

    it('ignores dragOver when no reorder drag is in progress', () => {
        const { result } = setup();
        const e = makeDragEvent();
        act(() => { result.current.getReorderDropProps(1, true).onDragOver!(e); });

        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(result.current.dragOverIndex).toBeNull();
    });

    it('tracks the hovered index once a reorder drag has started', () => {
        const { result } = setup();
        act(() => { result.current.handleReorderDragStart(makeDragEvent(), 0); });
        act(() => { result.current.getReorderDropProps(1, true).onDragOver!(makeDragEvent()); });
        expect(result.current.dragOverIndex).toBe(1);
    });

    it('exposes no drop handlers on a row that cannot be reordered', () => {
        const { result } = setup();
        expect(result.current.getReorderDropProps(2, false)).toEqual({});
    });
});

describe('reorder drop rules', () => {
    it('moves the commit and emits the new display order', () => {
        const { result, onReorder } = setup();
        act(() => { result.current.handleReorderDragStart(makeDragEvent(), 0); });
        act(() => { result.current.getReorderDropProps(1, true).onDrop!(makeDragEvent()); });

        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0][0].map((c: GitCommitItem) => c.hash)).toEqual([B.hash, A.hash, C.hash]);
        expect(result.current.dragIndex).toBeNull();
        expect(result.current.dragOverIndex).toBeNull();
    });

    it('rejects a drop onto a pushed commit', () => {
        const { result, onReorder } = setup();
        act(() => { result.current.handleReorderDragStart(makeDragEvent(), 0); });
        act(() => { result.current.getReorderDropProps(2, true).onDrop!(makeDragEvent()); });
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('is a no-op when dropped on itself', () => {
        const { result, onReorder } = setup();
        act(() => { result.current.handleReorderDragStart(makeDragEvent(), 1); });
        act(() => { result.current.getReorderDropProps(1, true).onDrop!(makeDragEvent()); });
        expect(onReorder).not.toHaveBeenCalled();
        expect(result.current.dragIndex).toBeNull();
    });

    it('clears drag state on drag end', () => {
        const { result } = setup();
        act(() => { result.current.handleReorderDragStart(makeDragEvent(), 0); });
        act(() => { result.current.getReorderDropProps(0, true).onDragEnd!(); });
        expect(result.current.dragIndex).toBeNull();
        expect(result.current.dragOverIndex).toBeNull();
    });
});
