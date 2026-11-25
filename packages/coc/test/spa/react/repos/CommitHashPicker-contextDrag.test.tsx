/**
 * Recent-commit rows in the review header's commit switcher are copy-drag
 * sources for the chat composers. The payload names the concrete owning
 * workspace/server, and the row keeps its click-to-select behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommitHashPicker, type CommitPickerOptions } from '../../../../src/server/spa/client/react/features/git/commits/CommitHashPicker';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';
import { RepoGitDetailPane, type RepoGitDetailPaneProps } from '../../../../src/server/spa/client/react/features/git/repoGitTab/RepoGitDetailPane';
import {
    createGitCommitContextDragPayload, POINTER_CONTEXT_DRAG_MIME,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { readSessionContextDropPayloads, validateSessionContextDrop } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

// The commit review body is out of scope: render only the header switcher it receives.
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({
    CommitDetail: ({ hash, commitPicker }: { hash: string; commitPicker?: CommitPickerOptions }) =>
        commitPicker ? <CommitHashPicker hash={hash} picker={commitPicker} /> : null,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitReviewChat', () => ({ CommitReviewChat: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitChatPresentation', () => ({ useCommitChatPresentation: () => ({}) }));

const commit = (hash: string, subject: string): GitCommitItem => ({
    hash, shortHash: hash.slice(0, 7), subject, author: 'A', date: '2026-11-01T00:00:00Z', parentHashes: [],
});
const CURRENT = commit('1da3ade1f00000000000000000000000000000aa', 'current change');
const OTHER = commit('a335fd736000000000000000000000000000000b', 'other change');
const member = 'ws-member';
const group = 'group-team';
const route = (workspaceId: string, serverId = 'server-a') => buildRemoteCloneKey(serverId, workspaceId);

function transfer() {
    const data = new Map<string, string>();
    return {
        effectAllowed: 'none',
        getData: (key: string) => data.get(key) ?? '',
        setData: (key: string, value: string) => { data.set(key, value); },
    };
}
const trigger = () => screen.getByTestId('commit-hash-picker-trigger');
const row = (c: GitCommitItem) => screen.getByTestId(`commit-hash-picker-option-${c.hash}`);
async function open() { await act(async () => { fireEvent.click(trigger()); }); }
function dragRow(c: GitCommitItem) {
    const dataTransfer = transfer();
    fireEvent.dragStart(row(c), { dataTransfer });
    return dataTransfer;
}

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
});

describe('CommitHashPicker recent-commit context drag', () => {
    const contextDrag = (c: GitCommitItem) => createGitCommitContextDragPayload(c, { activeWorkspaceId: member, sourceRoutingRef: null });

    it('writes a copy-only commit pointer for the dragged row', async () => {
        render(<CommitHashPicker hash={CURRENT.hash} picker={{ commits: [CURRENT, OTHER], onSelect: vi.fn(), contextDrag }} />);
        await open();
        const other = row(OTHER);
        expect(other.getAttribute('draggable')).toBe('true');
        expect(other.getAttribute('data-session-context-source')).toBe('true');
        expect(other.getAttribute('data-session-context-kind')).toBe('commit');
        expect(other.getAttribute('title')).toBe('other change - drag to attach as commit context');
        const dataTransfer = dragRow(OTHER);
        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(JSON.parse(dataTransfer.getData(POINTER_CONTEXT_DRAG_MIME))).toMatchObject({
            kind: 'coc.git-commit-context', sourceWorkspaceId: member, sourceRoutingRef: null,
            commitHash: OTHER.hash, shortHash: 'a335fd7', subject: 'other change',
        });
        // Dragging neither selects nor closes the menu.
        expect(screen.getByTestId('commit-hash-picker')).toBeTruthy();
    });

    it('keeps click-to-select and menu close on a draggable row', async () => {
        const onSelect = vi.fn();
        render(<CommitHashPicker hash={CURRENT.hash} picker={{ commits: [CURRENT, OTHER], onSelect, contextDrag }} />);
        await open();
        await act(async () => { fireEvent.click(row(OTHER)); });
        expect(onSelect).toHaveBeenCalledWith(OTHER);
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('leaves rows click-only without a builder or when the builder declines', async () => {
        const { unmount } = render(<CommitHashPicker hash={CURRENT.hash} picker={{ commits: [CURRENT, OTHER], onSelect: vi.fn() }} />);
        await open();
        expect(row(OTHER).getAttribute('draggable')).toBe('false');
        expect(row(OTHER).getAttribute('data-session-context-source')).toBeNull();
        expect(row(OTHER).getAttribute('title')).toBe('other change');
        unmount();
        render(<CommitHashPicker hash={CURRENT.hash} picker={{ commits: [CURRENT, OTHER], onSelect: vi.fn(), contextDrag: () => null }} />);
        await open();
        expect(row(OTHER).getAttribute('draggable')).toBe('false');
    });
});

describe('RepoGitDetailPane commit switcher ownership', () => {
    beforeEach(() => {
        registerCloneBaseUrls(['server-a', 'server-b'].flatMap(serverId => [member, group].map(workspaceId => ({
            workspaceId, serverId, baseUrl: serverId === 'server-a' ? 'https://a.example' : 'https://b.example',
        }))));
    });

    function renderPane(props: Partial<RepoGitDetailPaneProps>) {
        const base = {
            workspaceId: member, view: { type: 'commit', commit: CURRENT }, commits: [CURRENT, OTHER],
            onSelectCommit: vi.fn(), unpushedCount: 0, branchRangeData: null, branchRangeFiles: [],
            baseMode: 'merge-base', onBaseModeChange: vi.fn(), repoRoot: '/repo', hunkTarget: 'first',
            onBranchFileSelect: vi.fn(), onNavigateToBranchFile: vi.fn(), onNavigateToCommitFile: vi.fn(),
            onNavigateToWorkingTreeFile: vi.fn(), onAllBranchCommentsClick: vi.fn(), onBranchAskAI: vi.fn(), onCommitClassified: vi.fn(),
        } as unknown as RepoGitDetailPaneProps;
        return render(<RepoGitDetailPane {...base} {...props} />);
    }

    it('is click-only while session-context attachments are off', async () => {
        renderPane({ attachmentDestinationId: member });
        await open();
        expect(row(OTHER).getAttribute('draggable')).toBe('false');
    });

    it('drags a local commit with its workspace, name and no routing ref', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        renderPane({ attachmentDestinationId: member, sourceWorkspaceName: 'Member repository' });
        await open();
        const [payload] = readSessionContextDropPayloads(dragRow(OTHER));
        expect(payload).toMatchObject({
            sourceWorkspaceId: member, sourceRoutingRef: null, sourceWorkspaceName: 'Member repository', commitHash: OTHER.hash,
        });
    });

    it('routes a remote member commit to its own clone and only to chats on that server', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        renderPane({ attachmentDestinationId: route(member), sourceWorkspaceName: 'Member repository' });
        await open();
        const [payload] = readSessionContextDropPayloads(dragRow(OTHER));
        expect(payload).toMatchObject({ sourceWorkspaceId: member, sourceRoutingRef: route(member), commitHash: OTHER.hash });
        const drop = (activeWorkspaceId: string, activeRoutingRef: string | null) => validateSessionContextDrop({
            payload, activeWorkspaceId, activeRoutingRef, featureEnabled: true, canRetrieveConversations: false, existingItems: [],
        });
        // The group's composer on the same server accepts the member commit…
        expect(drop(group, route(group)).ok).toBe(true);
        // …a composer on another server or the local server does not.
        expect(drop(group, route(group, 'server-b')).ok).toBe(false);
        expect(drop(group, null).ok).toBe(false);
    });

    it('fails closed when a remote-cloned workspace has no concrete owner', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        renderPane({ attachmentDestinationId: undefined });
        await open();
        expect(row(OTHER).getAttribute('draggable')).toBe('false');
        await act(async () => { fireEvent.click(row(OTHER)); });
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
    });
});
