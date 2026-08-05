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

    it('RepoDetail routes the queue seed and Resume Queue to the clone', () => {
        expect(repoDetail).toContain("getCocClientForWorkspace(ws.id).queue.list({ repoId: ws.id })");
        expect(repoDetail).toContain("getCocClientForWorkspace(ws.id).queue.resume({ repoId: ws.id })");
        // GET /queue?repoId= answers 200 with an EMPTY queue for an id the local
        // server doesn't know, so a remote clone's queue looked permanently idle.
        expect(repoDetail).not.toContain("fetchApi('/queue?repoId=");
        expect(repoDetail).not.toContain("fetchApi('/queue/resume?repoId=");
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

    it('WorkItemPlanSection enqueues the single-comment AI resolve on the clone', () => {
        const planSection = read('features/work-items/WorkItemPlanSection.tsx');
        expect(planSection).toContain('requestForWorkspace');
        expect(planSection).toContain('/batch-resolve');
        // POST /comments/:wsId/:taskPath/batch-resolve only validates the id SHAPE,
        // so a local-origin call answered 200 having enqueued the AI resolve task
        // on the WRONG host under the remote workspace's id.
        expect(planSection).not.toContain('fetchApi');
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

    it('DreamsPanel routes the dream store, repo preferences, and next-action fan-out to the clone', () => {
        const panel = read('features/dreams/DreamsPanel.tsx');
        expect(panel).toContain('getCocClientForWorkspace(workspaceId).dreams.');
        expect(panel).toContain('getCocClientForWorkspace(workspaceId).preferences.getRepo(workspaceId)');
        expect(panel).toContain('getCocClientForWorkspace(workspaceId).preferences.patchRepo(workspaceId');
        // NextActionDialog's queue/notes/memory/work-item fan-out is workspace-scoped too.
        expect(panel).toContain('const client = getCocClientForWorkspace(workspaceId);');
        // Neither the dreams routes nor /workspaces/:id/preferences resolve the
        // workspace, so the local singleton answered 200 with an EMPTY card list
        // and wrote the "enable dreams" preference on the wrong server.
        expect(panel).not.toContain('getSpaCocClient()');
        // getSpaCocClientErrorMessage stays.
        expect(panel).toContain('getSpaCocClientErrorMessage');
    });

    it('useCommitTemplatesController routes list/detail/delete to the clone', () => {
        const controller = read('features/templates/commit-templates/useCommitTemplatesController.ts');
        expect(controller).toContain('getCocClientForWorkspace(workspaceId).templates.list(workspaceId)');
        expect(controller).toContain('getCocClientForWorkspace(workspaceId).templates.detail(workspaceId, selectedName)');
        expect(controller).toContain('getCocClientForWorkspace(workspaceId).templates.delete(workspaceId, name)');
        // Every templates route calls resolveWorkspaceOrFail, so the local singleton
        // hard-404s a remote clone — and the list 404 is swallowed into an empty tab.
        expect(controller).not.toContain('getSpaCocClient');
        expect(controller).not.toContain('fetchApi');
    });

    it('the commit-template components route create/update/replicate and commit validation to the clone', () => {
        const components = read('features/templates/commit-templates/components.tsx');
        expect(components).toContain('getCocClientForWorkspace(workspaceId).templates.update(workspaceId');
        expect(components).toContain('getCocClientForWorkspace(workspaceId).templates.create(workspaceId');
        expect(components).toContain('getCocClientForWorkspace(workspaceId).templates.replicate(workspaceId');
        // Commit-hash validation on blur: local-origin fetch always said
        // "Commit not found or not reachable" for a remote clone.
        expect(components).toContain('requestForWorkspace');
        expect(components).toContain('/git/commits/');
        expect(components).not.toContain('getSpaCocClient');
        expect(components).not.toContain('fetchApi');
    });

    it('useRalphSessionView routes the per-session journal read to the clone', () => {
        const ralphView = read('features/chat/useRalphSessionView.ts');
        expect(ralphView).toContain('getCocClientForWorkspace(workspaceId)');
        expect(ralphView).toContain('.workspaces.ralphSession(workspaceId, sessionId)');
        // The bare local singleton must not return — it 404s a remote clone's
        // session ("Ralph session not found").
        expect(ralphView).not.toContain('getSpaCocClient');
    });

    it('ResolveContextDialog loads the /skill autocomplete list from the clone', () => {
        const dialog = read('shared/ResolveContextDialog.tsx');
        expect(dialog).toContain('getCocClientForWorkspace(wsId).skills.listAllWorkspace(wsId)');
        // GET /workspaces/:id/skills/all does an inline workspace lookup + 404, and
        // the dialog swallows the error — a remote clone silently showed zero skills.
        expect(dialog).not.toContain('getSpaCocClient');
    });

    it('the notes paper-annotation layers route every sidecar read/write to the clone', () => {
        for (const rel of [
            'features/notes/editor/extensions/usePaperAnnotations.ts',
            'features/notes/editor/extensions/PdfAnnotationsLayer.tsx',
            'features/notes/editor/extensions/PdfQuickAskLayer.tsx',
            'features/notes/editor/extensions/PdfRegionAskLayer.tsx',
        ]) {
            const src = read(rel);
            expect(src).toContain('requestForWorkspace');
            // Every paper-annotations route starts with resolveWorkspaceOrFail, so
            // the local-origin client hard-404s a remote clone's note.
            expect(src).not.toContain('fetchApi');
        }
    });

    it('the quick-ask layers run the AI invocation on the workspace\'s own host', () => {
        for (const rel of [
            'features/notes/editor/extensions/NoteQuickAskLayer.tsx',
            'features/notes/editor/extensions/PdfQuickAskLayer.tsx',
            'features/notes/editor/extensions/PdfRegionAskLayer.tsx',
            'features/notes/editor/extensions/PdfAnnotationsLayer.tsx',
        ]) {
            const src = read(rel);
            expect(src).toContain('/api/quick-ask/answer?workspace=');
            expect(src).toContain('requestForWorkspace');
            // POST /api/quick-ask/answer only validates the id SHAPE — it never
            // looks the workspace up — so a local-origin call answers 200 having
            // run the model on the WRONG host with the wrong model config.
            expect(src).not.toContain('fetchApi');
        }
    });

    it('the chat quick-ask side-notes hook reads/writes on the workspace\'s own host', () => {
        const hook = read('features/chat/quick-ask/useQuickAskSidenotes.ts');
        expect(hook).toContain('requestForWorkspace<{ sidenotes?: ChatSideNote[] }>(workspaceId, basePath)');
        expect(hook).toContain('requestForWorkspace<{ sidenote?: ChatSideNote }>(workspaceId, basePath, {');
        expect(hook).toContain('requestForWorkspace(workspaceId, delPath, { method: \'DELETE\' })');
        // The sidenotes routes only validate the id SHAPE, so a local-origin call
        // for a remote clone answered 200 after creating
        // `{dataDir}/repos/<remote-id>/chat-sidenotes/` on the WRONG host.
        expect(hook).not.toContain('fetchApi');
    });

    it('NoteEditorIO builds the PDF/image byte URLs against the clone', () => {
        const io = read('features/notes/editor/NoteEditorIO.ts');
        expect(io).toContain('cloneApiBase(workspaceId)');
        expect(io).toContain('${notesApiBase(workspaceId)}/workspaces/');
        // No bare `/api/workspaces/...` literals: those are handed to <img src> /
        // data-pdf-url / a raw fetch, so a remote clone's PDF 404'd from the page
        // origin and there was nothing to annotate.
        expect(io).not.toContain('`/api/workspaces/');
    });

    it('ModalJobAiControls reads and writes the last-provider repo preference on the clone', () => {
        const controls = read('shared/ModalJobAiControls.tsx');
        expect(controls).toContain('getCocClientForWorkspace(workspaceId).preferences.getRepo(workspaceId)');
        expect(controls).toContain('getCocClientForWorkspace(workspaceId).preferences.patchRepo(workspaceId');
        // /workspaces/:id/preferences is keyed by id only (no workspace resolve), so
        // the local singleton answered 200 from the WRONG server's preference file
        // and the provider selector reset to the fallback on every open.
        expect(controls).not.toContain('getSpaCocClient');
    });

    it('MarkdownReviewDialog reveals through the clone-aware explorerApi', () => {
        const dialog = read('processes/MarkdownReviewDialog.tsx');
        expect(dialog).toContain('explorerApi.reveal(wsId, filePath)');
        // GET /repos/:id/reveal resolves the repo and 404s an unknown id.
        expect(dialog).not.toContain('getSpaCocClient');
    });

    it('file-path hover previews use the link\'s own workspace id, routed to its clone', () => {
        const preview = read('shared/file-path/file-path-preview.ts');
        expect(preview).toContain('getCocClientForWorkspace(wsId).tasks.previewWorkspaceFile(wsId, path)');
        // The link's data-ws-id wins over the local-only rootPath heuristic, which
        // for a remote clone previewed an arbitrary unrelated local repo via
        // `workspaces[0]?.id`.
        expect(preview).toContain('fetchPreview(fullPath, linkWsId)');
        expect(preview).toContain('const wsId = knownWsId || resolved;');
        // The workspace list itself is a local-server call by design (it only
        // backs the fallback heuristic), so getSpaCocClient stays for that one.
        expect(preview).not.toContain('getSpaCocClient().tasks');
    });
});
