/**
 * @vitest-environment jsdom
 *
 * Regression tests for the branch-range per-file diff fetch.
 *
 * Bug: the Git tab's branch-range file list was loaded from the workspace's
 * owning server, but expanding a file fetched its diff through getSpaCocClient()
 * (the page-origin / LOCAL client). For a REMOTE workspace the local server has
 * no such workspace, so every inline preview showed "Workspace not found".
 *
 * Fix: BranchAllFilesDiff and BranchChanges route their branch-range calls
 * through getCocClientForWorkspace(workspaceId).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
    getCocClientForWorkspace: vi.fn(),
    localGetBranchRangeFileDiff: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

// Any call through the local client is the bug — fail it the way the local
// server does for a workspace it does not own.
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ git: { getBranchRangeFileDiff: mocks.localGetBranchRangeFileDiff } }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

import { BranchAllFilesDiff } from '../../../src/server/spa/client/react/features/git/branches/BranchAllFilesDiff';

const REMOTE_WS = 'ws-v2-remote000000000000000';
const FILE = 'src/app.ts';
const DIFF = 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new';

describe('BranchAllFilesDiff remote workspace routing', () => {
    let remoteGetBranchRangeFileDiff: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        remoteGetBranchRangeFileDiff = vi.fn().mockResolvedValue({ diff: DIFF, path: FILE });
        mocks.getCocClientForWorkspace.mockReturnValue({
            git: { getBranchRangeFileDiff: remoteGetBranchRangeFileDiff },
        });
        mocks.localGetBranchRangeFileDiff.mockRejectedValue(new Error('Workspace not found'));
    });

    function renderDiff(baseMode?: 'default-branch' | 'upstream') {
        return render(
            <BranchAllFilesDiff
                workspaceId={REMOTE_WS}
                files={[{ path: FILE, status: 'modified', additions: 1, deletions: 1 }]}
                onFileSelect={() => {}}
                baseMode={baseMode}
            />,
        );
    }

    it('fetches the expanded file diff from the owning server, not the local client', async () => {
        const { getByTestId, queryByText } = renderDiff('upstream');

        fireEvent.click(getByTestId(`branch-all-file-toggle-${FILE}`));

        await waitFor(() => {
            expect(getByTestId(`branch-all-file-diff-content-${FILE}`)).toBeTruthy();
        });
        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith(REMOTE_WS);
        expect(remoteGetBranchRangeFileDiff).toHaveBeenCalledWith(REMOTE_WS, FILE, { base: 'upstream' });
        expect(mocks.localGetBranchRangeFileDiff).not.toHaveBeenCalled();
        expect(queryByText('Workspace not found')).toBeNull();
    });

    it('shows the owning server error when the diff fetch fails', async () => {
        remoteGetBranchRangeFileDiff.mockRejectedValue(new Error('boom'));
        const { getByTestId, findByText } = renderDiff();

        fireEvent.click(getByTestId(`branch-all-file-toggle-${FILE}`));

        expect(await findByText('boom')).toBeTruthy();
        expect(mocks.localGetBranchRangeFileDiff).not.toHaveBeenCalled();
    });
});
