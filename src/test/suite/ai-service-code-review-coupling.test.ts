/**
 * AI Service / Code Review Coupling Tests
 * 
 * Tests to verify that the AI service module and code review module are properly
 * decoupled, and that the adapter pattern works correctly.
 * 
 * Key concerns being tested:
 * 1. AI service has generic APIs that don't require code-review knowledge
 * 2. Code review can use the generic APIs via adapter
 * 3. Legacy APIs continue to work for backward compatibility
 * 4. Processes are correctly tracked regardless of which API is used
 */

import * as assert from 'assert';
import { 
    AIProcessManager, 
    GenericProcessMetadata, 
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    AIProcess
} from '../../shortcuts/ai-service';
import {
    CodeReviewProcessAdapter,
    CodeReviewProcessData,
    CodeReviewGroupData,
    createCodeReviewProcessTracker,
    CODE_REVIEW_PROCESS_TYPE,
    CODE_REVIEW_GROUP_TYPE
} from '../../shortcuts/code-review/process-adapter';
import { CodeReviewMetadata } from '../../shortcuts/code-review/types';

/**
 * Mock extension context for testing
 */
function createMockContext(): { globalState: { get: () => unknown[]; update: () => Promise<void> } } {
    const storage = new Map<string, unknown>();
    return {
        globalState: {
            get: <T>(key: string, defaultValue: T): T => {
                return (storage.get(key) as T) ?? defaultValue;
            },
            update: async (key: string, value: unknown): Promise<void> => {
                storage.set(key, value);
            }
        }
    } as unknown as { globalState: { get: () => unknown[]; update: () => Promise<void> } };
}

suite('AI Service / Code Review Decoupling Tests', () => {

    suite('Generic Process API', () => {
        let processManager: AIProcessManager;

        setup(async () => {
            processManager = new AIProcessManager();
            await processManager.initialize(createMockContext() as any);
        });

        teardown(() => {
            processManager.dispose();
        });

        test('registerTypedProcess creates process with generic metadata', () => {
            const metadata: GenericProcessMetadata = {
                type: 'custom-feature',
                customField: 'value',
                numericField: 42
            };

            const id = processManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'custom-feature',
                    idPrefix: 'custom',
                    metadata
                }
            );

            assert.ok(id.startsWith('custom-'));
            
            const process = processManager.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'custom-feature');
            assert.ok(process.metadata);
            assert.strictEqual(process.metadata.type, 'custom-feature');
            assert.strictEqual(process.metadata.customField, 'value');
            assert.strictEqual(process.metadata.numericField, 42);
        });

        test('registerProcessGroup creates group with generic metadata', () => {
            const id = processManager.registerProcessGroup(
                'Group prompt',
                {
                    type: 'custom-group',
                    idPrefix: 'custom-group',
                    metadata: {
                        type: 'custom-group',
                        groupField: 'group-value'
                    }
                }
            );

            assert.ok(id.startsWith('custom-group-'));
            
            const process = processManager.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'custom-group');
            assert.ok(process.groupMetadata);
            assert.strictEqual(process.groupMetadata.type, 'custom-group');
            assert.deepStrictEqual(process.groupMetadata.childProcessIds, []);
        });

        test('child processes are added to parent group via generic API', () => {
            // Register a group
            const groupId = processManager.registerProcessGroup(
                'Group prompt',
                {
                    type: 'test-group',
                    idPrefix: 'test-group'
                }
            );

            // Register child processes
            const childId1 = processManager.registerTypedProcess(
                'Child 1',
                {
                    type: 'test-child',
                    parentProcessId: groupId
                }
            );

            const childId2 = processManager.registerTypedProcess(
                'Child 2',
                {
                    type: 'test-child',
                    parentProcessId: groupId
                }
            );

            // Verify children are tracked
            const childIds = processManager.getChildProcessIds(groupId);
            assert.strictEqual(childIds.length, 2);
            assert.ok(childIds.includes(childId1));
            assert.ok(childIds.includes(childId2));
        });

        test('completeProcessGroup updates group status and stores results', () => {
            const groupId = processManager.registerProcessGroup(
                'Group prompt',
                {
                    type: 'test-group'
                }
            );

            processManager.completeProcessGroup(groupId, {
                result: 'Summary result',
                structuredResult: JSON.stringify({ key: 'value' }),
                executionStats: {
                    total: 5,
                    successful: 4,
                    failed: 1
                }
            });

            const process = processManager.getProcess(groupId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, 'Summary result');
            assert.strictEqual(process.structuredResult, JSON.stringify({ key: 'value' }));
        });
    });

    suite('Legacy API Backward Compatibility', () => {
        let processManager: AIProcessManager;

        setup(async () => {
            processManager = new AIProcessManager();
            await processManager.initialize(createMockContext() as any);
        });

        teardown(() => {
            processManager.dispose();
        });

        test('registerCodeReviewProcess still works', () => {
            const id = processManager.registerCodeReviewProcess(
                'Review prompt',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    commitMessage: 'Test commit',
                    rulesUsed: ['rule1.md', 'rule2.md'],
                    diffStats: { files: 3, additions: 10, deletions: 5 }
                }
            );

            assert.ok(id.startsWith('review-'));
            
            const process = processManager.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'code-review');
            assert.ok(process.codeReviewMetadata);
            assert.strictEqual(process.codeReviewMetadata.reviewType, 'commit');
            assert.strictEqual(process.codeReviewMetadata.commitSha, 'abc123');
        });

        test('registerCodeReviewGroup still works', () => {
            const id = processManager.registerCodeReviewGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md'],
                diffStats: { files: 5, additions: 20, deletions: 10 }
            });

            assert.ok(id.startsWith('review-group-'));
            
            const process = processManager.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'code-review-group');
            assert.ok(process.codeReviewGroupMetadata);
            assert.strictEqual(process.codeReviewGroupMetadata.reviewType, 'pending');
            assert.deepStrictEqual(process.codeReviewGroupMetadata.childProcessIds, []);
        });

        test('getChildProcesses works with legacy code review groups', () => {
            const groupId = processManager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            const childId = processManager.registerCodeReviewProcess(
                'Child review',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md']
                },
                undefined,
                groupId
            );

            const children = processManager.getChildProcesses(groupId);
            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].id, childId);
        });
    });

    suite('Code Review Process Adapter', () => {
        let processManager: AIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(async () => {
            processManager = new AIProcessManager();
            await processManager.initialize(createMockContext() as any);
            adapter = new CodeReviewProcessAdapter(processManager, false); // Use legacy API
        });

        teardown(() => {
            processManager.dispose();
        });

        test('adapter.registerProcess creates process correctly', () => {
            const data: CodeReviewProcessData = {
                reviewType: 'commit',
                commitSha: 'def456',
                commitMessage: 'Another commit',
                rulesUsed: ['rule1.md'],
                diffStats: { files: 2, additions: 5, deletions: 3 }
            };

            const id = adapter.registerProcess('Review prompt', data);

            assert.ok(id);
            const process = adapter.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'code-review');
        });

        test('adapter.registerGroup creates group correctly', () => {
            const data: Omit<CodeReviewGroupData, 'childProcessIds' | 'executionStats'> = {
                reviewType: 'staged',
                rulesUsed: ['rule1.md', 'rule2.md']
            };

            const id = adapter.registerGroup(data);

            assert.ok(id);
            const process = adapter.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'code-review-group');
        });

        test('adapter tracks child processes in groups', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'pending',
                rulesUsed: ['rule.md']
            });

            const childId1 = adapter.registerProcess(
                'Child 1',
                { reviewType: 'pending', rulesUsed: ['rule.md'] },
                undefined,
                groupId
            );

            const childId2 = adapter.registerProcess(
                'Child 2',
                { reviewType: 'pending', rulesUsed: ['rule.md'] },
                undefined,
                groupId
            );

            const children = adapter.getChildProcesses(groupId);
            assert.strictEqual(children.length, 2);
            assert.ok(children.some(c => c.id === childId1));
            assert.ok(children.some(c => c.id === childId2));
        });

        test('adapter.completeGroup updates status', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'commit',
                commitSha: 'xyz789',
                rulesUsed: ['rule.md']
            });

            adapter.completeGroup(
                groupId,
                'Review complete',
                JSON.stringify({ summary: 'All good' }),
                { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 1000 }
            );

            const process = adapter.getProcess(groupId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, 'Review complete');
        });
    });

    suite('Code Review Process Tracker (Map-Reduce Integration)', () => {
        let processManager: AIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(async () => {
            processManager = new AIProcessManager();
            await processManager.initialize(createMockContext() as any);
            adapter = new CodeReviewProcessAdapter(processManager, false);
        });

        teardown(() => {
            processManager.dispose();
        });

        test('createCodeReviewProcessTracker returns valid ProcessTracker', () => {
            const metadata: CodeReviewMetadata = {
                type: 'commit',
                commitSha: 'test123',
                commitMessage: 'Test',
                rulesUsed: []
            };

            const tracker = createCodeReviewProcessTracker(adapter, metadata);

            assert.ok(tracker.registerProcess);
            assert.ok(tracker.updateProcess);
            assert.ok(tracker.registerGroup);
            assert.ok(tracker.completeGroup);
            assert.ok(tracker.updateGroupStructuredResult);
        });

        test('tracker registers processes and groups correctly', () => {
            const metadata: CodeReviewMetadata = {
                type: 'pending',
                rulesUsed: []
            };

            const tracker = createCodeReviewProcessTracker(adapter, metadata);

            const groupId = tracker.registerGroup('Group description');
            assert.ok(groupId);
            assert.strictEqual(tracker.groupId, groupId);

            const processId = tracker.registerProcess('Process description', groupId);
            assert.ok(processId);

            const children = adapter.getChildProcesses(groupId);
            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].id, processId);
        });

        test('tracker.updateGroupStructuredResult updates the group', () => {
            const metadata: CodeReviewMetadata = {
                type: 'staged',
                rulesUsed: []
            };

            const tracker = createCodeReviewProcessTracker(adapter, metadata);
            const groupId = tracker.registerGroup('Group');

            tracker.updateGroupStructuredResult(JSON.stringify({ result: 'test' }));

            const process = adapter.getProcess(groupId);
            assert.ok(process);
            assert.strictEqual(process.structuredResult, JSON.stringify({ result: 'test' }));
        });
    });

    suite('Generic API with Code Review Type', () => {
        let processManager: AIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(async () => {
            processManager = new AIProcessManager();
            await processManager.initialize(createMockContext() as any);
            // Use generic API (true flag)
            adapter = new CodeReviewProcessAdapter(processManager, true);
        });

        teardown(() => {
            processManager.dispose();
        });

        test('adapter using generic API creates process with metadata', () => {
            const data: CodeReviewProcessData = {
                reviewType: 'commit',
                commitSha: 'generic123',
                rulesUsed: ['rule.md']
            };

            const id = adapter.registerProcess('Generic API prompt', data);
            
            const process = adapter.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, CODE_REVIEW_PROCESS_TYPE);
            // Generic API stores in metadata field
            assert.ok(process.metadata);
            assert.strictEqual(process.metadata.type, CODE_REVIEW_PROCESS_TYPE);
            assert.strictEqual(process.metadata.reviewType, 'commit');
            assert.strictEqual(process.metadata.commitSha, 'generic123');
        });

        test('adapter using generic API creates group with metadata', () => {
            const id = adapter.registerGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const process = adapter.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, CODE_REVIEW_GROUP_TYPE);
            // Generic API stores in groupMetadata field
            assert.ok(process.groupMetadata);
            assert.strictEqual(process.groupMetadata.type, CODE_REVIEW_GROUP_TYPE);
        });
    });

    suite('Cross-API Compatibility', () => {
        let processManager: AIProcessManager;

        setup(async () => {
            processManager = new AIProcessManager();
            await processManager.initialize(createMockContext() as any);
        });

        teardown(() => {
            processManager.dispose();
        });

        test('getChildProcesses works with generic API groups', () => {
            // Create group using generic API
            const groupId = processManager.registerProcessGroup(
                'Generic group',
                { type: 'test-group' }
            );

            // Add children using generic API
            const childId1 = processManager.registerTypedProcess(
                'Child 1',
                { type: 'test-child', parentProcessId: groupId }
            );

            const childId2 = processManager.registerTypedProcess(
                'Child 2',
                { type: 'test-child', parentProcessId: groupId }
            );

            // getChildProcesses should work
            const children = processManager.getChildProcesses(groupId);
            assert.strictEqual(children.length, 2);
        });

        test('getTopLevelProcesses excludes child processes', () => {
            const groupId = processManager.registerProcessGroup(
                'Group',
                { type: 'test-group' }
            );

            processManager.registerTypedProcess(
                'Child',
                { type: 'test-child', parentProcessId: groupId }
            );

            processManager.registerProcess('Independent process');

            const topLevel = processManager.getTopLevelProcesses();
            // Should have group + independent, but not the child
            assert.strictEqual(topLevel.length, 2);
            assert.ok(topLevel.every(p => !p.parentProcessId));
        });

        test('processes serialize and deserialize with generic metadata', () => {
            const id = processManager.registerTypedProcess(
                'Test',
                {
                    type: 'custom-type',
                    metadata: {
                        type: 'custom-type',
                        field1: 'value1',
                        field2: 123
                    }
                }
            );

            processManager.updateProcess(id, 'completed', 'Result');

            // Get the process and verify metadata is preserved
            const process = processManager.getProcess(id);
            assert.ok(process);
            assert.ok(process.metadata);
            assert.strictEqual(process.metadata.field1, 'value1');
            assert.strictEqual(process.metadata.field2, 123);
        });
    });

    suite('Decoupling Verification', () => {
        test('ai-service types export generic metadata interfaces', () => {
            // Verify that the generic interfaces are exported
            const metadata: GenericProcessMetadata = {
                type: 'any-type',
                anyField: 'any-value'
            };
            assert.ok(metadata);

            const groupMetadata: GenericGroupMetadata = {
                type: 'group-type',
                childProcessIds: []
            };
            assert.ok(groupMetadata);
        });

        test('code-review defines its own process data types', () => {
            // Verify that code-review has its own types that don't depend on ai-service
            const processData: CodeReviewProcessData = {
                reviewType: 'commit',
                rulesUsed: []
            };
            assert.ok(processData);

            const groupData: CodeReviewGroupData = {
                reviewType: 'pending',
                rulesUsed: [],
                childProcessIds: []
            };
            assert.ok(groupData);
        });

        test('process type constants are defined in code-review module', () => {
            // These constants allow code-review to identify its process types
            assert.strictEqual(CODE_REVIEW_PROCESS_TYPE, 'code-review');
            assert.strictEqual(CODE_REVIEW_GROUP_TYPE, 'code-review-group');
        });
    });
});
