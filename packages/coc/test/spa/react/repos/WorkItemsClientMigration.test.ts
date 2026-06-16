import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEMS_DIR = path.join(REACT_SRC, 'features', 'work-items');

function readWorkItemComponent(fileName: string): string {
    return fs.readFileSync(path.join(WORK_ITEMS_DIR, fileName), 'utf-8');
}

describe('work items SPA client migration', () => {
    let createDialog: string;
    let detail: string;
    let executeDialog: string;
    let executionSession: string;
    let planSection: string;
    let section: string;

    beforeAll(() => {
        createDialog = readWorkItemComponent('CreateWorkItemDialog.tsx');
        detail = readWorkItemComponent('WorkItemDetail.tsx');
        executeDialog = readWorkItemComponent('WorkItemExecuteDialog.tsx');
        executionSession = readWorkItemComponent('WorkItemExecutionSession.tsx');
        planSection = readWorkItemComponent('WorkItemPlanSection.tsx');
        section = readWorkItemComponent('WorkItemSection.tsx');
    });

    it('creates manual and chat-derived work items through client.workItems', () => {
        expect(createDialog).toContain('cloneClient.workItems.createFromChat(workspaceId');
        expect(createDialog).toContain('cloneClient.workItems.createForOrigin(workItemOriginId');
        expect(createDialog).not.toContain('/work-items/from-chat');
    });

    it('loads, mutates, and deletes work item detail through client.workItems', () => {
        for (const call of [
            'workItems.getForOrigin(workItemOriginId, requestedWorkItemId',
            'workItems.updateStatusForOrigin(',
            'workItems.updateForOrigin(workItemOriginId, workItemId',
            'workItems.requestChangesForOrigin(workItemOriginId, workItemId',
            'workItems.resolveComments(workspaceId, workItemId',
            'workItems.deleteForOrigin(workItemOriginId, workItemId',
        ]) {
            expect(detail).toContain(call);
        }
        expect(detail).not.toContain('workItems.pin(workspaceId, workItemId');
        expect(detail).not.toContain('workItems.archive(workspaceId, workItemId');
        expect(detail).not.toContain('/work-items/${');
    });

    it('loads grouped lists and optimistic context-menu mutations through client.workItems', () => {
        expect(section).toContain('workItems.groupedForOrigin(workItemOriginId');
        expect(section).toContain('workItems.listForOrigin(workItemOriginId');
        expect(section).toContain('workItems.pinForOrigin(workItemOriginId, item.id');
        expect(section).toContain('workItems.archiveForOrigin(workItemOriginId, item.id');
        expect(section).toContain('workItems.deleteForOrigin(workItemOriginId, item.id');
        expect(section).not.toContain('/work-items/grouped');
    });

    it('loads hierarchy trees through the origin-scoped work item client', () => {
        const tree = readWorkItemComponent('WorkItemHierarchyTree.tsx');
        expect(tree).toContain('workItems.treeForOrigin(workItemOriginId');
        expect(tree).toContain('{ workspaceId }');
        expect(tree).not.toContain('workItems.tree(workspaceId');
    });

    it('loads plan versions through client.workItems and persists plan via the detail Ctrl+S batch', () => {
        expect(planSection).toContain('workItems.planVersionsForOrigin(workItemOriginId, workItemId, originOptions)');
        expect(planSection).toContain('workItems.getPlanVersionForOrigin(workItemOriginId, workItemId, v, originOptions)');
        expect(planSection).toContain('workItems.comparePlanVersionsForOrigin(workItemOriginId, workItemId');
        expect(planSection).toContain('workItems.restorePlanVersionForOrigin(workItemOriginId, workItemId');
        expect(planSection).toContain('workItems.resolveComments(workspaceId, workItemId');
        // Plan persistence moved into the unified Ctrl+S PATCH batch in WorkItemDetail;
        // the plan section no longer performs an instant standalone save.
        expect(planSection).not.toContain('workItems.updatePlan(');
        expect(planSection).not.toContain('workItems.planVersions(workspaceId');
        expect(planSection).not.toContain('workItems.getPlanVersion(workspaceId');
        expect(detail).toContain('updates.plan');
        expect(detail).not.toContain('workItems.updatePlan(workspaceId, workItemId, planDraft');
    });

    it('executes work items through client.workItems while keeping skill loading separate', () => {
        expect(executeDialog).toContain('workItems.execute(workspaceId, workItemId');
        expect(executeDialog).toContain("'/workspaces/' + encodeURIComponent(workspaceId) + '/skills'");
    });

    it('loads the execute-dialog skill list through the clone-aware client, not the local-origin fetchApi', () => {
        // Regression: for a remote clone, GET /workspaces/:id/skills must target the
        // clone's own server. Routing it through the local-origin fetchApi 404s with
        // "Workspace not found" because the local server has no such workspace.
        expect(executeDialog).toContain('cloneClient.request');
        expect(executeDialog).toContain("'/workspaces/' + encodeURIComponent(workspaceId) + '/skills'");
        expect(executeDialog).not.toContain('fetchApi');
    });

    it('loads execution session data through typed process and queue clients', () => {
        expect(executionSession).toContain('queue.getTask(taskId)');
        expect(executionSession).toContain('processes.get(pid)');
        expect(executionSession).toContain('queue.resolvedPrompt(taskId)');
        expect(executionSession).toContain('queue.list()');
    });

    it('drafts and improves work items through client.workItems.aiDraft and aiImprove', () => {
        const composerSrc = fs.readFileSync(
            path.join(WORK_ITEMS_DIR, 'WorkItemAiComposer.tsx'),
            'utf-8',
        );
        expect(composerSrc).toContain('workItems.aiDraft(workspaceId');
        expect(composerSrc).toContain('workItems.aiImprove(workspaceId');
        // Must not hit the AI endpoint URLs directly
        expect(composerSrc).not.toContain('/ai-draft');
    });
});
