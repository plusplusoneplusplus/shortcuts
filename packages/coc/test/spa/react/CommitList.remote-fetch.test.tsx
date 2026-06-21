/**
 * @vitest-environment jsdom
 *
 * Regression tests for CommitList's per-commit changed-files fetch.
 *
 * Bug: the file list was fetched through getSpaCocClient() (the page-origin /
 * LOCAL client) keyed by the commit's workspaceId. For a commit on a REMOTE
 * workspace the id only resolves on its owning server; the local server has no
 * clone at that path, so `git diff-tree` returned nothing and the UI showed
 * "No files changed" for every unpushed commit.
 *
 * Fix: route both fetch sites (click-to-expand and deep-link auto-expand)
 * through getCocClientForWorkspace(workspaceId) — the same routing the recent
 * PR-status fix adopted. These tests assert a remote workspace resolves to its
 * owning server and never hits the local client, and that the changed files
 * actually render (no false "No files changed").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { mockViewport } from '../helpers/viewport-mock';
import type { GitCommitItem } from '../../../src/server/spa/client/react/features/git/commits/CommitList';

const mocks = vi.hoisted(() => ({
    getCocClientForWorkspace: vi.fn(),
}));

// The component must route every workspace-scoped call through this helper. The
// remote-routing tests below override it to assert a remote workspace never
// resolves to the shared local client.
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

// Inert stubs for the comment-count / view-mode hooks: each makes its own
// network + WebSocket calls we don't exercise here. The returns MUST be stable
// singletons — the component feeds commentCounts into an effect's dependency
// array, so a fresh Map per render would loop forever. flat view mode renders
// FlatFileList so changed files surface as `commit-file-<path>` rows.
const EMPTY_COUNTS = new Map<string, number>();
const EMPTY_TOTALS = new Map();
const FLAT_VIEW = { mode: 'flat' as const, setMode: () => {} };
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: () => EMPTY_COUNTS,
}));
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useCommitCommentTotals', () => ({
    useCommitCommentTotals: () => EMPTY_TOTALS,
}));
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => FLAT_VIEW,
}));

import { CommitList } from '../../../src/server/spa/client/react/features/git/commits/CommitList';

const HASH = 'abc1234deadbeef0000000000000000000000000';
const SHORT = 'abc1234';
const CHANGED_FILE = 'src/foo.ts';

function commit(): GitCommitItem {
    return {
        hash: HASH,
        shortHash: SHORT,
        subject: 'fix(coc): route chat PR-status fetches',
        author: 'Yiheng Tao',
        date: '2026-06-21T02:04:21Z',
        parentHashes: ['0000000000000000000000000000000000000000'],
    };
}

function makeClient() {
    return {
        git: {
            listCommitFiles: vi.fn().mockResolvedValue({
                files: [{ status: 'M', path: CHANGED_FILE }],
            }),
        },
    };
}

describe('CommitList — remote-aware changed-files fetch', () => {
    let restoreViewport: () => void;

    beforeEach(() => {
        restoreViewport = mockViewport(1280);
        mocks.getCocClientForWorkspace.mockReset();
    });

    afterEach(() => {
        restoreViewport();
        vi.restoreAllMocks();
    });

    it('regression: click-to-expand routes through the workspace owning server, never the local client', async () => {
        const REMOTE_WS = 'ws-xjvuoc';
        const remoteClient = makeClient();
        const localClient = makeClient();
        mocks.getCocClientForWorkspace.mockImplementation((wsId: string) =>
            wsId === REMOTE_WS ? remoteClient : localClient,
        );

        const { getByTestId } = render(
            <CommitList title="Unpushed" commits={[commit()]} workspaceId={REMOTE_WS} unpushedCount={1} />,
        );

        fireEvent.click(getByTestId(`commit-row-${SHORT}`));

        // The changed file renders — the bug showed "No files changed" here.
        await waitFor(() => getByTestId(`commit-file-${CHANGED_FILE}`));

        // Routed to the workspace's owning server, keyed by its id.
        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith(REMOTE_WS);
        expect(remoteClient.git.listCommitFiles).toHaveBeenCalledWith(REMOTE_WS, HASH);
        // The default local client is never used for a remote workspace.
        expect(localClient.git.listCommitFiles).not.toHaveBeenCalled();
    });

    it('regression: deep-link auto-expand also routes through the workspace owning server', async () => {
        const REMOTE_WS = 'ws-xjvuoc';
        const remoteClient = makeClient();
        const localClient = makeClient();
        mocks.getCocClientForWorkspace.mockImplementation((wsId: string) =>
            wsId === REMOTE_WS ? remoteClient : localClient,
        );

        const { getByTestId } = render(
            <CommitList
                title="Unpushed"
                commits={[commit()]}
                workspaceId={REMOTE_WS}
                initialExpandedHash={HASH}
                unpushedCount={1}
            />,
        );

        await waitFor(() => getByTestId(`commit-file-${CHANGED_FILE}`));

        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith(REMOTE_WS);
        expect(remoteClient.git.listCommitFiles).toHaveBeenCalledWith(REMOTE_WS, HASH);
        expect(localClient.git.listCommitFiles).not.toHaveBeenCalled();
    });

    it('a local workspace still resolves to the default client and renders files', async () => {
        const LOCAL_WS = 'ws-local';
        const localClient = makeClient();
        mocks.getCocClientForWorkspace.mockReturnValue(localClient);

        const { getByTestId } = render(
            <CommitList title="Unpushed" commits={[commit()]} workspaceId={LOCAL_WS} unpushedCount={1} />,
        );

        fireEvent.click(getByTestId(`commit-row-${SHORT}`));

        await waitFor(() => getByTestId(`commit-file-${CHANGED_FILE}`));
        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith(LOCAL_WS);
        expect(localClient.git.listCommitFiles).toHaveBeenCalledWith(LOCAL_WS, HASH);
    });
});
