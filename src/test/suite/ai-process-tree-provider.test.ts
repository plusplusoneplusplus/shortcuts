/**
 * Unit tests for AI Process Tree Data Provider
 * Tests hierarchical display of code review groups
 */

import * as assert from 'assert';
import { AIProcessItem, AIProcessTreeDataProvider, AIProcessTreeItem, MockAIProcessManager } from '../../shortcuts/ai-service';

/**
 * Type guard to check if a tree item is an AIProcessItem
 */
function isAIProcessItem(item: AIProcessTreeItem): item is AIProcessItem {
    return 'process' in item;
}

/**
 * Assert that tree items are AIProcessItems and return them typed
 */
function assertAIProcessItems(items: AIProcessTreeItem[]): AIProcessItem[] {
    const processItems: AIProcessItem[] = [];
    for (const item of items) {
        assert.ok(isAIProcessItem(item), 'Expected AIProcessItem');
        processItems.push(item);
    }
    return processItems;
}

suite('AI Process Tree Provider Tests', () => {

    suite('Hierarchical Display', () => {

        test('should show group at top level', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            assert.strictEqual(processItems.length, 1);
            assert.strictEqual(processItems[0].process.id, groupId);
            assert.strictEqual(processItems[0].process.type, 'code-review-group');

            provider.dispose();
        });

        test('should not show child processes at top level', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            manager.registerCodeReviewProcess(
                'Prompt 1',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            manager.registerCodeReviewProcess(
                'Prompt 2',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule2.md'] },
                undefined,
                groupId
            );

            // All processes exist
            const allProcesses = manager.getProcesses();
            assert.strictEqual(allProcesses.length, 3);

            // But only group is at top level
            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            assert.strictEqual(processItems.length, 1);
            assert.strictEqual(processItems[0].process.type, 'code-review-group');

            provider.dispose();
        });

        test('should show child processes when expanding group', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const childId1 = manager.registerCodeReviewProcess(
                'Prompt 1',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            const childId2 = manager.registerCodeReviewProcess(
                'Prompt 2',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule2.md'] },
                undefined,
                groupId
            );

            // Get the group item
            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            const groupItem = processItems[0];

            // Get children of the group
            const children = await provider.getChildren(groupItem);
            const childItems = assertAIProcessItems(children);
            assert.strictEqual(childItems.length, 2);

            const childIds = childItems.map(c => c.process.id);
            assert.ok(childIds.includes(childId1));
            assert.ok(childIds.includes(childId2));

            provider.dispose();
        });

        test('should show standalone processes at top level', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            // Create a group with children
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            manager.registerCodeReviewProcess(
                'Prompt 1',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            // Create standalone processes
            const standaloneId = manager.registerProcess('Standalone clarification');
            const singleReviewId = manager.registerCodeReviewProcess(
                'Single rule review',
                { reviewType: 'commit', commitSha: 'def456', rulesUsed: ['other-rule.md'] }
            );

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            assert.strictEqual(processItems.length, 3); // group + standalone + single review

            const topLevelIds = processItems.map(t => t.process.id);
            assert.ok(topLevelIds.includes(groupId));
            assert.ok(topLevelIds.includes(standaloneId));
            assert.ok(topLevelIds.includes(singleReviewId));

            provider.dispose();
        });
    });

    suite('AIProcessItem Properties', () => {

        test('should have Expanded collapsible state for groups', () => {
            const groupProcess = {
                id: 'group-1',
                type: 'code-review-group' as const,
                promptPreview: 'Review: abc123 (2 rules)',
                fullPrompt: 'Group prompt',
                status: 'running' as const,
                startTime: new Date(),
                codeReviewGroupMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    childProcessIds: []
                }
            };

            const item = new AIProcessItem(groupProcess);

            // Groups should be expandable
            // TreeItemCollapsibleState.Expanded = 2
            assert.strictEqual(item.collapsibleState, 2);
        });

        test('should have None collapsible state for regular processes', () => {
            const regularProcess = {
                id: 'process-1',
                type: 'clarification' as const,
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'running' as const,
                startTime: new Date()
            };

            const item = new AIProcessItem(regularProcess);

            // Regular processes should not be expandable
            // TreeItemCollapsibleState.None = 0
            assert.strictEqual(item.collapsibleState, 0);
        });

        test('should have correct context value for code review group', () => {
            const groupProcess = {
                id: 'group-1',
                type: 'code-review-group' as const,
                promptPreview: 'Review: abc123 (2 rules)',
                fullPrompt: 'Group prompt',
                status: 'completed' as const,
                startTime: new Date(),
                endTime: new Date(),
                codeReviewGroupMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    childProcessIds: []
                }
            };

            const item = new AIProcessItem(groupProcess);

            assert.strictEqual(item.contextValue, 'codeReviewGroupProcess_completed');
        });

        test('should have _child suffix in context value for child processes', () => {
            const childProcess = {
                id: 'child-1',
                type: 'code-review' as const,
                promptPreview: 'rule1.md',
                fullPrompt: 'Review prompt',
                status: 'completed' as const,
                startTime: new Date(),
                endTime: new Date(),
                parentProcessId: 'group-1',
                codeReviewMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md']
                }
            };

            // Pass isChild = true
            const item = new AIProcessItem(childProcess, true);

            assert.strictEqual(item.contextValue, 'codeReviewProcess_completed_child');
        });

        test('should have correct command for viewing group details', () => {
            const groupProcess = {
                id: 'group-1',
                type: 'code-review-group' as const,
                promptPreview: 'Review: abc123 (2 rules)',
                fullPrompt: 'Group prompt',
                status: 'completed' as const,
                startTime: new Date(),
                endTime: new Date(),
                structuredResult: '{}',
                codeReviewGroupMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    childProcessIds: []
                }
            };

            const item = new AIProcessItem(groupProcess);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'clarificationProcesses.viewCodeReviewGroupDetails');
        });
    });

    suite('Sorting', () => {

        test('should sort running processes first at top level', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            // Create completed group
            const groupId1 = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });
            manager.completeCodeReviewGroup(groupId1, 'Done', '{}', { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 1000 });

            // Create running group
            const groupId2 = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'def456',
                rulesUsed: ['rule2.md']
            });

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);

            // Running should be first
            assert.strictEqual(processItems[0].process.id, groupId2);
            assert.strictEqual(processItems[0].process.status, 'running');

            provider.dispose();
        });

        test('should sort child processes by start time', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md']
            });

            // Register children in order
            const childId1 = manager.registerCodeReviewProcess(
                'Prompt 1',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));

            const childId2 = manager.registerCodeReviewProcess(
                'Prompt 2',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule2.md'] },
                undefined,
                groupId
            );

            await new Promise(resolve => setTimeout(resolve, 10));

            const childId3 = manager.registerCodeReviewProcess(
                'Prompt 3',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule3.md'] },
                undefined,
                groupId
            );

            // Get group item
            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            const groupItem = processItems[0];

            // Get children
            const children = await provider.getChildren(groupItem);
            const childItems = assertAIProcessItems(children);

            // Should be sorted by start time (oldest first for children)
            assert.strictEqual(childItems[0].process.id, childId1);
            assert.strictEqual(childItems[1].process.id, childId2);
            assert.strictEqual(childItems[2].process.id, childId3);

            provider.dispose();
        });
    });

    suite('Get Parent', () => {

        test('should return parent for child process item', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            manager.registerCodeReviewProcess(
                'Prompt',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            // Get child item
            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            const groupItem = processItems[0];
            const children = await provider.getChildren(groupItem);
            const childItems = assertAIProcessItems(children);
            const childItem = childItems[0];

            // Get parent
            const parent = provider.getParent(childItem);

            assert.ok(parent);
            assert.ok(isAIProcessItem(parent));
            assert.strictEqual(parent.process.id, groupId);

            provider.dispose();
        });

        test('should return undefined for top-level process', async () => {
            const manager = new MockAIProcessManager();

            const provider = new AIProcessTreeDataProvider(manager);

            manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            const groupItem = processItems[0];

            const parent = provider.getParent(groupItem);

            assert.strictEqual(parent, undefined);

            provider.dispose();
        });
    });

    suite('Queued Status Display', () => {

        test('should show queued processes in tree', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Register a queued process
            const queuedId = manager.registerTypedProcess(
                'Queued task prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            assert.strictEqual(processItems.length, 1);
            assert.strictEqual(processItems[0].process.id, queuedId);
            assert.strictEqual(processItems[0].process.status, 'queued');

            provider.dispose();
        });

        test('should sort running before queued at top level', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Create queued process first
            const queuedId = manager.registerTypedProcess(
                'Queued task',
                { type: 'clarification', initialStatus: 'queued' }
            );

            // Then running process
            const runningId = manager.registerTypedProcess(
                'Running task',
                { type: 'clarification', initialStatus: 'running' }
            );

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);

            // Running should be first, queued second
            assert.strictEqual(processItems[0].process.id, runningId);
            assert.strictEqual(processItems[0].process.status, 'running');
            assert.strictEqual(processItems[1].process.id, queuedId);
            assert.strictEqual(processItems[1].process.status, 'queued');

            provider.dispose();
        });

        test('should sort queued before completed at top level', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Create completed process first
            const completedId = manager.registerTypedProcess(
                'Completed task',
                { type: 'clarification', initialStatus: 'running' }
            );
            manager.completeProcess(completedId, 'Done');

            // Then queued process
            const queuedId = manager.registerTypedProcess(
                'Queued task',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);

            // Queued should be first, completed second
            assert.strictEqual(processItems[0].process.id, queuedId);
            assert.strictEqual(processItems[0].process.status, 'queued');
            assert.strictEqual(processItems[1].process.id, completedId);
            assert.strictEqual(processItems[1].process.status, 'completed');

            provider.dispose();
        });

        test('should have correct context value for queued process', () => {
            const queuedProcess = {
                id: 'process-1',
                type: 'clarification' as const,
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'queued' as const,
                startTime: new Date()
            };

            const item = new AIProcessItem(queuedProcess);

            assert.strictEqual(item.contextValue, 'clarificationProcess_queued');
        });

        test('should have correct context value for queued code-review process', () => {
            const queuedProcess = {
                id: 'process-1',
                type: 'code-review' as const,
                promptPreview: 'Review prompt',
                fullPrompt: 'Full review prompt',
                status: 'queued' as const,
                startTime: new Date(),
                codeReviewMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md']
                }
            };

            const item = new AIProcessItem(queuedProcess);

            assert.strictEqual(item.contextValue, 'codeReviewProcess_queued');
        });

        test('should have correct context value for queued code-review-group', () => {
            const queuedGroup = {
                id: 'group-1',
                type: 'code-review-group' as const,
                promptPreview: 'Review: abc123',
                fullPrompt: 'Group prompt',
                status: 'queued' as const,
                startTime: new Date(),
                codeReviewGroupMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    childProcessIds: []
                }
            };

            const item = new AIProcessItem(queuedGroup);

            assert.strictEqual(item.contextValue, 'codeReviewGroupProcess_queued');
        });

        test('should show queued child processes within group', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Create a group
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            // Add queued child
            const queuedChildId = manager.registerTypedProcess(
                'Queued child review',
                { 
                    type: 'code-review', 
                    initialStatus: 'queued',
                    parentProcessId: groupId 
                }
            );

            // Get group item
            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            const groupItem = processItems[0];

            // Get children
            const children = await provider.getChildren(groupItem);
            const childItems = assertAIProcessItems(children);
            
            assert.strictEqual(childItems.length, 1);
            assert.strictEqual(childItems[0].process.id, queuedChildId);
            assert.strictEqual(childItems[0].process.status, 'queued');

            provider.dispose();
        });

        test('should sort running children before queued children', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Create a group
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            // Add queued child first
            const queuedChildId = manager.registerTypedProcess(
                'Queued child',
                { 
                    type: 'code-review', 
                    initialStatus: 'queued',
                    parentProcessId: groupId 
                }
            );

            // Add running child second
            const runningChildId = manager.registerTypedProcess(
                'Running child',
                { 
                    type: 'code-review', 
                    initialStatus: 'running',
                    parentProcessId: groupId 
                }
            );

            // Get group item
            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            const groupItem = processItems[0];

            // Get children - running should be first
            const children = await provider.getChildren(groupItem);
            const childItems = assertAIProcessItems(children);
            
            assert.strictEqual(childItems.length, 2);
            assert.strictEqual(childItems[0].process.id, runningChildId);
            assert.strictEqual(childItems[0].process.status, 'running');
            assert.strictEqual(childItems[1].process.id, queuedChildId);
            assert.strictEqual(childItems[1].process.status, 'queued');

            provider.dispose();
        });

        test('should update display when queued transitions to running', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Register a queued process
            const processId = manager.registerTypedProcess(
                'Task to transition',
                { type: 'clarification', initialStatus: 'queued' }
            );

            // Verify initial state
            let topLevel = await provider.getChildren();
            let processItems = assertAIProcessItems(topLevel);
            assert.strictEqual(processItems[0].process.status, 'queued');

            // Transition to running
            manager.updateProcess(processId, 'running');

            // Verify updated state
            topLevel = await provider.getChildren();
            processItems = assertAIProcessItems(topLevel);
            assert.strictEqual(processItems[0].process.status, 'running');

            provider.dispose();
        });

        test('should show multiple queued processes sorted by start time', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Register multiple queued processes with small delays
            const id1 = manager.registerTypedProcess(
                'First queued',
                { type: 'clarification', initialStatus: 'queued' }
            );

            await new Promise(resolve => setTimeout(resolve, 10));

            const id2 = manager.registerTypedProcess(
                'Second queued',
                { type: 'clarification', initialStatus: 'queued' }
            );

            await new Promise(resolve => setTimeout(resolve, 10));

            const id3 = manager.registerTypedProcess(
                'Third queued',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const topLevel = await provider.getChildren();
            const processItems = assertAIProcessItems(topLevel);
            
            // All queued, should be sorted by start time (newest first for top level)
            assert.strictEqual(processItems.length, 3);
            assert.strictEqual(processItems[0].process.id, id3);
            assert.strictEqual(processItems[1].process.id, id2);
            assert.strictEqual(processItems[2].process.id, id1);

            provider.dispose();
        });
    });
});
