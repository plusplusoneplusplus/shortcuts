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
        expect(createDialog).toContain('getSpaCocClient().workItems.createFromChat(workspaceId');
        expect(createDialog).toContain('getSpaCocClient().workItems.create(workspaceId');
        expect(createDialog).not.toContain('/work-items/from-chat');
    });

    it('loads, mutates, and deletes work item detail through client.workItems', () => {
        for (const call of [
            'workItems.get(requestedWorkspaceId, requestedWorkItemId)',
            'workItems.updateStatus(workspaceId, workItemId',
            'workItems.update(workspaceId, workItemId',
            'workItems.requestChanges(workspaceId, workItemId',
            'workItems.resolveComments(workspaceId, workItemId',
            'workItems.delete(workspaceId, workItemId)',
        ]) {
            expect(detail).toContain(call);
        }
        expect(detail).not.toContain('workItems.pin(workspaceId, workItemId');
        expect(detail).not.toContain('workItems.archive(workspaceId, workItemId');
        expect(detail).not.toContain('/work-items/${');
    });

    it('loads grouped lists and optimistic context-menu mutations through client.workItems', () => {
        expect(section).toContain('workItems.grouped(workspaceId');
        expect(section).toContain('workItems.list(workspaceId');
        expect(section).toContain('workItems.pin(workspaceId, item.id');
        expect(section).toContain('workItems.archive(workspaceId, item.id');
        expect(section).toContain('workItems.delete(workspaceId, item.id)');
        expect(section).not.toContain('/work-items/grouped');
    });

    it('loads plan versions through client.workItems and persists plan via the detail Ctrl+S batch', () => {
        expect(planSection).toContain('workItems.planVersions(workspaceId, workItemId)');
        expect(planSection).toContain('workItems.getPlanVersion(workspaceId, workItemId, v)');
        expect(planSection).toContain('workItems.resolveComments(workspaceId, workItemId');
        // Plan persistence moved into the unified Ctrl+S PATCH batch in WorkItemDetail;
        // the plan section no longer performs an instant standalone save.
        expect(planSection).not.toContain('workItems.updatePlan(');
        expect(detail).toContain('updates.plan');
        expect(detail).not.toContain('workItems.updatePlan(workspaceId, workItemId, planDraft');
    });

    it('executes work items through client.workItems while keeping skill loading separate', () => {
        expect(executeDialog).toContain('workItems.execute(workspaceId, workItemId');
        expect(executeDialog).toContain("'/workspaces/' + encodeURIComponent(workspaceId) + '/skills'");
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
