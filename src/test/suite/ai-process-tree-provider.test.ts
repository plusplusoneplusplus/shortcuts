/**
 * Unit tests for AI Process Tree Data Provider
 * Tests hierarchical display of code review groups
 */

import * as assert from 'assert';
import { AIProcessItem, AIProcessTreeDataProvider, MockAIProcessManager } from '../../shortcuts/ai-service';

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
            assert.strictEqual(topLevel.length, 1);
            assert.strictEqual(topLevel[0].process.id, groupId);
            assert.strictEqual(topLevel[0].process.type, 'code-review-group');

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
            assert.strictEqual(topLevel.length, 1);
            assert.strictEqual(topLevel[0].process.type, 'code-review-group');

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
            const groupItem = topLevel[0];

            // Get children of the group
            const children = await provider.getChildren(groupItem);
            assert.strictEqual(children.length, 2);

            const childIds = children.map(c => c.process.id);
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
            assert.strictEqual(topLevel.length, 3); // group + standalone + single review

            const topLevelIds = topLevel.map(t => t.process.id);
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

            // Running should be first
            assert.strictEqual(topLevel[0].process.id, groupId2);
            assert.strictEqual(topLevel[0].process.status, 'running');

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
            const groupItem = topLevel[0];

            // Get children
            const children = await provider.getChildren(groupItem);

            // Should be sorted by start time (oldest first for children)
            assert.strictEqual(children[0].process.id, childId1);
            assert.strictEqual(children[1].process.id, childId2);
            assert.strictEqual(children[2].process.id, childId3);

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
            const groupItem = topLevel[0];
            const children = await provider.getChildren(groupItem);
            const childItem = children[0];

            // Get parent
            const parent = provider.getParent(childItem);

            assert.ok(parent);
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
            const groupItem = topLevel[0];

            const parent = provider.getParent(groupItem);

            assert.strictEqual(parent, undefined);

            provider.dispose();
        });
    });
});
