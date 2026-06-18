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

    beforeAll(() => {
        enqueue = read('queue/EnqueueDialog.tsx');
        settings = read('features/repo-settings/RepoSettingsTab.tsx');
        repoDetail = read('features/repo-detail/RepoDetail.tsx');
        workItemsTab = read('features/work-items/WorkItemsTab.tsx');
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

    it('useRalphSessionView routes the per-session journal read to the clone', () => {
        const ralphView = read('features/chat/useRalphSessionView.ts');
        expect(ralphView).toContain('getCocClientForWorkspace(workspaceId)');
        expect(ralphView).toContain('.workspaces.ralphSession(workspaceId, sessionId)');
        // The bare local singleton must not return — it 404s a remote clone's
        // session ("Ralph session not found").
        expect(ralphView).not.toContain('getSpaCocClient');
    });
});
