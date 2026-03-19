/**
 * Unit tests for AI Process Group (Hierarchical Code Review)
 * Tests for the parent-child relationship in code review processes
 */

import * as assert from 'assert';
import { AIProcessManager, AIProcess, serializeProcess, deserializeProcess, CodeReviewGroupMetadata, MockAIProcessManager } from '../../shortcuts/ai-service';

/**
 * Mock ExtensionContext for testing persistence
 * Only needed for persistence tests that use real AIProcessManager
 */
class MockGlobalState {
    private storage: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.storage.set(key, value);
    }

    getStorage(): Map<string, unknown> {
        return this.storage;
    }
}

class MockExtensionContext {
    globalState = new MockGlobalState();
    workspaceState = new MockGlobalState();
}

suite('AI Process Group Tests', () => {

    suite('Code Review Group Registration', () => {

        test('should create a code review group process', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123def456',
                commitMessage: 'Test commit message',
                rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md'],
                diffStats: { files: 5, additions: 100, deletions: 50 }
            });

            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.strictEqual(group.type, 'code-review-group');
            assert.strictEqual(group.status, 'running');
            assert.ok(group.codeReviewGroupMetadata);
            assert.strictEqual(group.codeReviewGroupMetadata.childProcessIds.length, 0);
            assert.strictEqual(group.codeReviewGroupMetadata.rulesUsed.length, 3);
        });

        test('should generate correct preview for commit review group', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123def456',
                commitMessage: 'Test commit',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.ok(group.promptPreview.includes('abc123d'));
            assert.ok(group.promptPreview.includes('2 rules'));
        });

        test('should generate correct preview for pending changes group', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md']
            });

            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.ok(group.promptPreview.includes('pending'));
            assert.ok(group.promptPreview.includes('3 rules'));
        });

        test('should generate correct preview for staged changes group', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'staged',
                rulesUsed: ['rule1.md']
            });

            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.ok(group.promptPreview.includes('staged'));
            assert.ok(group.promptPreview.includes('1 rules'));
        });
    });

    suite('Child Process Registration', () => {

        test('should link child process to parent group', () => {
            const manager = new MockAIProcessManager();

            // Create group
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            // Register child processes
            const childId1 = manager.registerCodeReviewProcess(
                'Review prompt for rule1',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md']
                },
                undefined,
                groupId
            );

            const childId2 = manager.registerCodeReviewProcess(
                'Review prompt for rule2',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule2.md']
                },
                undefined,
                groupId
            );

            // Verify parent has children
            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.ok(group.codeReviewGroupMetadata);
            assert.strictEqual(group.codeReviewGroupMetadata.childProcessIds.length, 2);
            assert.ok(group.codeReviewGroupMetadata.childProcessIds.includes(childId1));
            assert.ok(group.codeReviewGroupMetadata.childProcessIds.includes(childId2));

            // Verify children have parent reference
            const child1 = manager.getProcess(childId1);
            const child2 = manager.getProcess(childId2);
            assert.ok(child1);
            assert.ok(child2);
            assert.strictEqual(child1.parentProcessId, groupId);
            assert.strictEqual(child2.parentProcessId, groupId);
        });

        test('should show rule filename as preview for single-rule child process', () => {
            const manager = new MockAIProcessManager();

            const childId = manager.registerCodeReviewProcess(
                'Review prompt',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['naming-conventions.md']
                }
            );

            const child = manager.getProcess(childId);
            assert.ok(child);
            assert.strictEqual(child.promptPreview, 'naming-conventions.md');
        });
    });

    suite('Get Child Processes', () => {

        test('should return child processes for a group', () => {
            const manager = new MockAIProcessManager();

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

            const children = manager.getChildProcesses(groupId);
            assert.strictEqual(children.length, 2);
        });

        test('should return empty array for non-existent group', () => {
            const manager = new MockAIProcessManager();

            const children = manager.getChildProcesses('non-existent-id');
            assert.strictEqual(children.length, 0);
        });

        test('should return empty array for non-group process', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Regular process');
            const children = manager.getChildProcesses(processId);
            assert.strictEqual(children.length, 0);
        });
    });

    suite('Top Level Processes', () => {

        test('should return only processes without parents', () => {
            const manager = new MockAIProcessManager();

            // Create a group with children
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

            // Create a standalone process
            const standaloneId = manager.registerProcess('Standalone process');

            // Get all processes
            const allProcesses = manager.getProcesses();
            assert.strictEqual(allProcesses.length, 4); // group + 2 children + standalone

            // Get top-level processes only
            const topLevel = manager.getTopLevelProcesses();
            assert.strictEqual(topLevel.length, 2); // group + standalone

            const topLevelIds = topLevel.map(p => p.id);
            assert.ok(topLevelIds.includes(groupId));
            assert.ok(topLevelIds.includes(standaloneId));
        });
    });

    suite('Is Child Process', () => {

        test('should return true for child processes', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            const childId = manager.registerCodeReviewProcess(
                'Prompt',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            assert.ok(manager.isChildProcess(childId));
        });

        test('should return false for parent processes', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            assert.ok(!manager.isChildProcess(groupId));
        });

        test('should return false for standalone processes', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Standalone');
            assert.ok(!manager.isChildProcess(processId));
        });
    });

    suite('Complete Code Review Group', () => {

        test('should complete group with execution stats', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const executionStats = {
                totalRules: 2,
                successfulRules: 2,
                failedRules: 0,
                totalTimeMs: 5000
            };

            const structuredResult = JSON.stringify({
                summary: {
                    totalFindings: 3,
                    overallAssessment: 'needs-attention'
                }
            });

            manager.completeCodeReviewGroup(
                groupId,
                'Review complete with 3 findings',
                structuredResult,
                executionStats
            );

            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.strictEqual(group.status, 'completed');
            assert.ok(group.endTime);
            assert.strictEqual(group.result, 'Review complete with 3 findings');
            assert.strictEqual(group.structuredResult, structuredResult);
            assert.ok(group.codeReviewGroupMetadata);
            assert.deepStrictEqual(group.codeReviewGroupMetadata.executionStats, executionStats);
        });

        test('should not complete non-group process', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Regular process');

            manager.completeCodeReviewGroup(
                processId,
                'Result',
                '{}',
                { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 1000 }
            );

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'running'); // Should not be affected
        });

        test('should update process structured result', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                commitMessage: 'Test commit',
                rulesUsed: ['rule1.md']
            });

            // Complete the group with a placeholder structured result
            manager.completeCodeReviewGroup(
                groupId,
                'Initial result',
                '{"placeholder": true}',
                { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 1000 }
            );

            // Update with the full structured result using the generic method
            const fullStructuredResult = JSON.stringify({
                metadata: { commitSha: 'abc123' },
                summary: { totalFindings: 5, overallAssessment: 'needs-attention' },
                findings: [{ severity: 'warning', description: 'Test finding' }]
            });

            manager.updateProcessStructuredResult(groupId, fullStructuredResult);

            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.strictEqual(group.structuredResult, fullStructuredResult);
        });

        test('should update structured result for any process type', () => {
            const manager = new MockAIProcessManager();

            // Test with a regular clarification process
            const processId = manager.registerProcess('Regular process');
            manager.completeProcess(processId, 'Some result');

            manager.updateProcessStructuredResult(processId, '{"test": true}');

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.structuredResult, '{"test": true}');
        });
    });

    suite('Serialization with Group Metadata', () => {

        test('should serialize code review group metadata', () => {
            const process: AIProcess = {
                id: 'review-group-1',
                type: 'code-review-group',
                promptPreview: 'Review: abc123 (2 rules)',
                fullPrompt: 'Code review group',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                codeReviewGroupMetadata: {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    commitMessage: 'Test commit',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    childProcessIds: ['child-1', 'child-2'],
                    executionStats: {
                        totalRules: 2,
                        successfulRules: 2,
                        failedRules: 0,
                        totalTimeMs: 5000
                    }
                }
            };

            const serialized = serializeProcess(process);

            assert.ok(serialized.codeReviewGroupMetadata);
            assert.strictEqual(serialized.codeReviewGroupMetadata.reviewType, 'commit');
            assert.strictEqual(serialized.codeReviewGroupMetadata.commitSha, 'abc123');
            assert.strictEqual(serialized.codeReviewGroupMetadata.childProcessIds.length, 2);
            assert.ok(serialized.codeReviewGroupMetadata.executionStats);
        });

        test('should serialize parent process ID', () => {
            const process: AIProcess = {
                id: 'child-1',
                type: 'code-review',
                promptPreview: 'rule1.md',
                fullPrompt: 'Review prompt',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                parentProcessId: 'review-group-1'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.parentProcessId, 'review-group-1');
        });

        test('should deserialize code review group metadata', () => {
            const serialized = {
                id: 'review-group-1',
                type: 'code-review-group' as const,
                promptPreview: 'Review: abc123 (2 rules)',
                fullPrompt: 'Code review group',
                status: 'completed' as const,
                startTime: '2024-01-15T10:30:00.000Z',
                endTime: '2024-01-15T10:35:00.000Z',
                codeReviewGroupMetadata: {
                    reviewType: 'commit' as const,
                    commitSha: 'abc123',
                    commitMessage: 'Test commit',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    childProcessIds: ['child-1', 'child-2'],
                    executionStats: {
                        totalRules: 2,
                        successfulRules: 2,
                        failedRules: 0,
                        totalTimeMs: 5000
                    }
                }
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.type, 'code-review-group');
            assert.ok(process.codeReviewGroupMetadata);
            assert.strictEqual(process.codeReviewGroupMetadata.reviewType, 'commit');
            assert.strictEqual(process.codeReviewGroupMetadata.childProcessIds.length, 2);
        });

        test('should deserialize parent process ID', () => {
            const serialized = {
                id: 'child-1',
                type: 'code-review' as const,
                promptPreview: 'rule1.md',
                fullPrompt: 'Review prompt',
                status: 'completed' as const,
                startTime: '2024-01-15T10:30:00.000Z',
                parentProcessId: 'review-group-1'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.parentProcessId, 'review-group-1');
        });

        test('should preserve group data through serialize/deserialize cycle', () => {
            const original: AIProcess = {
                id: 'review-group-test',
                type: 'code-review-group',
                promptPreview: 'Review: abc123 (3 rules)',
                fullPrompt: 'Code review group with 3 rules',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'Found 5 issues',
                codeReviewGroupMetadata: {
                    reviewType: 'pending',
                    rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md'],
                    childProcessIds: ['child-1', 'child-2', 'child-3'],
                    diffStats: { files: 10, additions: 200, deletions: 100 },
                    executionStats: {
                        totalRules: 3,
                        successfulRules: 2,
                        failedRules: 1,
                        totalTimeMs: 8000
                    }
                }
            };

            const serialized = serializeProcess(original);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.id, original.id);
            assert.strictEqual(restored.type, 'code-review-group');
            assert.ok(restored.codeReviewGroupMetadata);
            assert.strictEqual(restored.codeReviewGroupMetadata.reviewType, 'pending');
            assert.strictEqual(restored.codeReviewGroupMetadata.rulesUsed.length, 3);
            assert.strictEqual(restored.codeReviewGroupMetadata.childProcessIds.length, 3);
            assert.deepStrictEqual(restored.codeReviewGroupMetadata.diffStats, original.codeReviewGroupMetadata!.diffStats);
            assert.deepStrictEqual(restored.codeReviewGroupMetadata.executionStats, original.codeReviewGroupMetadata!.executionStats);
        });
    });

    suite('Persistence with Groups', () => {
        // These tests require real AIProcessManager with MockExtensionContext
        // because they test actual persistence behavior

        test('should persist group and children separately', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            // Create group with children
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

            // Complete all processes
            manager.completeCodeReviewProcess(childId1, 'Result 1', '{"summary":{"totalFindings":1}}');
            manager.completeCodeReviewProcess(childId2, 'Result 2', '{"summary":{"totalFindings":2}}');
            manager.completeCodeReviewGroup(
                groupId,
                'Total 3 findings',
                '{"summary":{"totalFindings":3}}',
                { totalRules: 2, successfulRules: 2, failedRules: 0, totalTimeMs: 5000 }
            );

            // Create new manager and load from storage
            const manager2 = new AIProcessManager();
            await manager2.initialize(context as never);

            // Verify all processes were restored
            const allProcesses = manager2.getProcesses();
            assert.strictEqual(allProcesses.length, 3);

            // Verify group was restored with metadata
            const restoredGroup = manager2.getProcess(groupId);
            assert.ok(restoredGroup);
            assert.strictEqual(restoredGroup.type, 'code-review-group');
            assert.ok(restoredGroup.codeReviewGroupMetadata);
            assert.strictEqual(restoredGroup.codeReviewGroupMetadata.childProcessIds.length, 2);

            // Verify children have parent reference
            const restoredChild1 = manager2.getProcess(childId1);
            assert.ok(restoredChild1);
            assert.strictEqual(restoredChild1.parentProcessId, groupId);
        });

        test('should restore top-level processes correctly after reload', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            // Create group with children
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            const childId = manager.registerCodeReviewProcess(
                'Prompt',
                { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            // Create standalone process
            const standaloneId = manager.registerProcess('Standalone');

            // Complete all
            manager.completeCodeReviewProcess(childId, 'Result', '{}');
            manager.completeCodeReviewGroup(groupId, 'Done', '{}', { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 1000 });
            manager.completeProcess(standaloneId, 'Done');

            // Reload
            const manager2 = new AIProcessManager();
            await manager2.initialize(context as never);

            // Verify top-level processes
            const topLevel = manager2.getTopLevelProcesses();
            assert.strictEqual(topLevel.length, 2);

            const topLevelIds = topLevel.map(p => p.id);
            assert.ok(topLevelIds.includes(groupId));
            assert.ok(topLevelIds.includes(standaloneId));
            assert.ok(!topLevelIds.includes(childId));
        });
    });
});
