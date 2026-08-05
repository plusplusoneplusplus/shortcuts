/**
 * Regression: the remaining workspace-scoped SPA call sites route to the selected
 * clone's server via the clone registry (remote clones hit their own host) instead
 * of the local-origin fetchApi / default getSpaCocClient(). Before this, each of
 * these 404'd ("Workspace not found") when the selected clone was remote.
 *
 * Source-grep style (mirrors WorkItemsClientMigration) so a revert to the
 * local-origin client fails loudly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const read = (rel: string) => fs.readFileSync(path.join(REACT_SRC, rel), 'utf-8');

describe('remote-clone routing sweep', () => {
    let enqueue: string;
    let settings: string;
    let repoDetail: string;
    let workItemsTab: string;
    let branchPicker: string;

    beforeAll(() => {
        enqueue = read('queue/EnqueueDialog.tsx');
        settings = read('features/repo-settings/RepoSettingsTab.tsx');
        repoDetail = read('features/repo-detail/RepoDetail.tsx');
        workItemsTab = read('features/work-items/WorkItemsTab.tsx');
        branchPicker = read('features/git/branches/BranchPickerModal.tsx');
    });

    it('EnqueueDialog routes loads, the enqueue mutation, and skill-usage to the clone', () => {
        expect(enqueue).toContain("requestForWorkspace<any>(workspaceId, '/workspaces/' + encodeURIComponent(workspaceId) + '/summary')");
        expect(enqueue).toContain("requestForWorkspace<any>(workspaceId, '/workspaces/' + encodeURIComponent(workspaceId) + '/skills/all')");
        expect(enqueue).toContain('getCocClientForWorkspace(workspaceId).queue.enqueue(body)');
        expect(enqueue).toContain('getCocClientForWorkspace(workspaceId).preferences.recordSkillUsage(workspaceId');
        // No local-origin fallthrough remains.
        expect(enqueue).not.toContain('fetchApi');
        expect(enqueue).not.toContain('getSpaCocClient()');
    });

    it('RepoSettingsTab routes its whole workspace-scoped surface to the clone', () => {
        expect(settings).toContain('requestForWorkspace');
        expect(settings).toContain('getCocClientForWorkspace(workspaceId)');
        expect(settings).not.toContain('fetchApi');
        // getSpaCocClientErrorMessage is still allowed; the bare client is not.
        expect(settings).not.toContain('getSpaCocClient()');
    });

    it('RepoDetail routes the work-items badge preview to the clone', () => {
        expect(repoDetail).toContain('getCocClientForWorkspace(ws.id).workItems.listForOrigin(workItemOriginId');
        expect(repoDetail).toContain('{ limit: 20 }');
        expect(repoDetail).not.toContain('fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/work-items');
    });

    it('WorkItemsTab routes the commit file list to the clone', () => {
        expect(workItemsTab).toContain('requestForWorkspace');
        expect(workItemsTab).toContain('/git/commits/');
        expect(workItemsTab).not.toContain('fetchApi');
    });

    it('BranchPickerModal routes branch list and switch requests to the clone', () => {
        expect(branchPicker).toContain('getCocClientForWorkspace(workspaceId).git.listBranches(workspaceId');
        expect(branchPicker).toContain('getCocClientForWorkspace(workspaceId).git.switchBranch(workspaceId');
        expect(branchPicker).not.toContain('getSpaCocClient');
    });

    it('useCommitChatBinding routes the whole commit-chat surface to the clone', () => {
        const hook = read('features/git/hooks/useCommitChatBinding.ts');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).git.getCommitChatBinding(workspaceId, commitHash)');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).queue.enqueue(');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).git.createCommitChatBinding(workspaceId, commitHash, newTaskId)');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).git.startFreshCommitChat(workspaceId, commitHash)');
        // The bare local singleton 404s a remote clone's commit ("Workspace not found").
        expect(hook).not.toContain('getSpaCocClient');
    });

    it('usePrChatBinding routes the PR chat enqueue to the clone', () => {
        const hook = read('features/git/hooks/usePrChatBinding.ts');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).queue.enqueue(');
        expect(hook).not.toContain('getSpaCocClient');
    });

    it('useFilesViewMode routes the repo preference read/write to the clone', () => {
        const hook = read('features/git/hooks/useFilesViewMode.ts');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).preferences.getRepo(workspaceId)');
        expect(hook).toContain('getCocClientForWorkspace(workspaceId).preferences.updateRepo(workspaceId');
        expect(hook).not.toContain('getSpaCocClient');
    });

    it('CommitDetail builds its diff path from the clone client', () => {
        const detail = read('features/git/commits/CommitDetail.tsx');
        expect(detail).toContain('getCocClientForWorkspace(workspaceId).git.commitDiffPath(workspaceId, hash)');
        expect(detail).not.toContain('getSpaCocClient');
    });

    it('WorkItemDetail routes its diff-comment READ through the clone-aware helper', () => {
        const detail = read('features/work-items/WorkItemDetail.tsx');
        expect(detail).toContain('listDiffCommentsForRange(workspaceId, `${sha}^`, sha)');
        // The list route does NOT resolve the workspace: a local-origin read for a
        // remote clone answers 200 with an EMPTY list, so this silently reported
        // "No open comments to resolve" instead of failing.
        expect(detail).not.toContain('fetchApi');
    });

    it('the branch-range comment views read through the clone-aware helper', () => {
        const overview = read('features/git/branches/BranchRangeOverview.tsx');
        expect(overview).toContain('listDiffCommentsForRange(workspaceId, range.baseRef, range.headRef)');
        expect(overview).not.toContain('getSpaCocClient');

        const allComments = read('features/git/branches/BranchRangeAllComments.tsx');
        expect(allComments).toContain('listDiffCommentsForRange(workspaceId, baseRef, headRef)');
        expect(allComments).not.toContain('getSpaCocClient');
    });

    it('diffCommentApi keeps every diff-comment REST call clone-routed', () => {
        const api = read('utils/diffCommentApi.ts');
        expect(api).toContain('getCocClientForWorkspace(wsId).git.listDiffComments(wsId, { oldRef, newRef })');
        expect(api).toContain('getCocClientForWorkspace(wsId).git.updateDiffComment(');
        expect(api).toContain('getCocClientForWorkspace(wsId).git.deleteDiffComment(');
        expect(api).not.toContain('getSpaCocClient');
    });

    it('useRalphSessionView routes the per-session journal read to the clone', () => {
        const ralphView = read('features/chat/useRalphSessionView.ts');
        expect(ralphView).toContain('getCocClientForWorkspace(workspaceId)');
        expect(ralphView).toContain('.workspaces.ralphSession(workspaceId, sessionId)');
        // The bare local singleton must not return — it 404s a remote clone's
        // session ("Ralph session not found").
        expect(ralphView).not.toContain('getSpaCocClient');
    });
});
