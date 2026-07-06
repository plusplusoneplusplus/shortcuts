/**
 * Tests for CommitList — multi-select context drag bundling (AC-02).
 *
 * A drag started on a commit that is part of the active selection
 * (`selectedHashes`) carries EVERY selected commit; a drag from an unselected
 * commit carries only that one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// Enable the session-context drag feature so commit rows become drag sources.
vi.mock('../../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, isSessionContextAttachmentsEnabled: () => true };
});

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

const mockUseFileCommentCounts = vi.fn<[string, string | null, string | null], Map<string, number>>();
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: (...args: any[]) => mockUseFileCommentCounts(...args),
}));

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) => `key-${filePath}`,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitTooltip', () => ({
    CommitTooltip: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    TruncatedPath: ({ path }: { path: string }) => <span>{path}</span>,
}));

import { CommitList } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import { readSessionContextDropPayloads } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import type { GitCommitContextDragPayload } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

const COMMIT_A: GitCommitItem = { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'Fix bug A', author: 'Alice', date: '2024-01-01T00:00:00Z', parentHashes: [] };
const COMMIT_B: GitCommitItem = { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'Add feature B', author: 'Bob', date: '2024-01-02T00:00:00Z', parentHashes: [] };
const COMMIT_C: GitCommitItem = { hash: 'c'.repeat(40), shortHash: 'ccccccc', subject: 'Refactor C', author: 'Carol', date: '2024-01-03T00:00:00Z', parentHashes: [] };
const COMMITS = [COMMIT_A, COMMIT_B, COMMIT_C];

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchApi.mockResolvedValue({ files: [] });
    mockUseFileCommentCounts.mockReturnValue(new Map());
    restoreViewport = mockViewport(1280);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    restoreViewport();
});

function makeRecordingDataTransfer() {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'none' as DataTransfer['effectAllowed'],
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
        get types() { return Array.from(store.keys()); },
    };
}

function dragStartAndRead(shortHash: string) {
    const dataTransfer = makeRecordingDataTransfer();
    fireEvent.dragStart(screen.getByTestId(`commit-row-${shortHash}`), { dataTransfer });
    return readSessionContextDropPayloads(dataTransfer) as GitCommitContextDragPayload[];
}

describe('CommitList — multi-select context drag bundling (AC-02)', () => {
    it('bundles every selected commit when the dragged commit is in the selection', () => {
        render(
            <CommitList
                title="History"
                commits={COMMITS}
                workspaceId="ws-1"
                selectedHashes={new Set([COMMIT_A.hash, COMMIT_B.hash])}
                onMultiSelect={vi.fn()}
            />,
        );

        const payloads = dragStartAndRead(COMMIT_A.shortHash);
        expect(payloads.map(p => p.commitHash)).toEqual([COMMIT_A.hash, COMMIT_B.hash]);
    });

    it('keeps the dragged commit first in the bundle even when dragged second', () => {
        render(
            <CommitList
                title="History"
                commits={COMMITS}
                workspaceId="ws-1"
                selectedHashes={new Set([COMMIT_A.hash, COMMIT_B.hash, COMMIT_C.hash])}
                onMultiSelect={vi.fn()}
            />,
        );

        const payloads = dragStartAndRead(COMMIT_B.shortHash);
        expect(payloads[0].commitHash).toBe(COMMIT_B.hash);
        expect(payloads.map(p => p.commitHash).sort()).toEqual([COMMIT_A.hash, COMMIT_B.hash, COMMIT_C.hash].sort());
    });

    it('carries only the dragged commit when it is not part of the selection', () => {
        render(
            <CommitList
                title="History"
                commits={COMMITS}
                workspaceId="ws-1"
                selectedHashes={new Set([COMMIT_A.hash, COMMIT_B.hash])}
                onMultiSelect={vi.fn()}
            />,
        );

        const payloads = dragStartAndRead(COMMIT_C.shortHash);
        expect(payloads.map(p => p.commitHash)).toEqual([COMMIT_C.hash]);
    });

    it('carries only the dragged commit when there is no multi-selection', () => {
        render(
            <CommitList
                title="History"
                commits={COMMITS}
                workspaceId="ws-1"
                selectedHash={COMMIT_A.hash}
            />,
        );

        const payloads = dragStartAndRead(COMMIT_A.shortHash);
        expect(payloads.map(p => p.commitHash)).toEqual([COMMIT_A.hash]);
    });
});
