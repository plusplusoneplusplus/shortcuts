/**
 * Code Review with MockAIProcessManager Tests
 * 
 * Comprehensive unit tests using MockAIProcessManager for testing code review
 * functionality without VSCode dependencies or persistence overhead.
 * 
 * Test Categories:
 * 1. Process Registration - Verify processes are registered with correct metadata
 * 2. Group Management - Test parent-child relationships
 * 3. Completion Flow - Test process completion with mock's mockCompleteProcess()
 * 4. Error Scenarios - Test failure handling with mockFailProcess()
 * 5. Call Verification - Use getCalls() to verify expected interactions
 */

import * as assert from 'assert';
import {
    MockAIProcessManager,
    createMockAIProcessManager,
    ProcessCall
} from '../../shortcuts/ai-service';
import {
    CodeReviewProcessAdapter,
    CodeReviewProcessData,
    CodeReviewGroupData,
    createCodeReviewProcessTracker,
    ICodeReviewProcessAdapter
} from '../../shortcuts/code-review/process-adapter';
import { CodeReviewMetadata } from '../../shortcuts/code-review/types';

suite('Code Review with MockAIProcessManager', () => {

    // ========================================================================
    // Process Registration Tests
    // ========================================================================

    suite('Process Registration', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('registers commit review with full metadata', () => {
            const data: CodeReviewProcessData = {
                reviewType: 'commit',
                commitSha: 'abc123def456',
                commitMessage: 'feat: add new feature',
                rulesUsed: ['naming-conventions.md', 'error-handling.md'],
                diffStats: { files: 5, additions: 100, deletions: 20 }
            };

            const id = adapter.registerProcess('Full review prompt', data);
            const process = adapter.getProcess(id);

            assert.ok(process);
            assert.strictEqual(process.type, 'code-review');
            assert.strictEqual(process.codeReviewMetadata?.reviewType, 'commit');
            assert.strictEqual(process.codeReviewMetadata?.commitSha, 'abc123def456');
            assert.strictEqual(process.codeReviewMetadata?.commitMessage, 'feat: add new feature');
            assert.deepStrictEqual(process.codeReviewMetadata?.rulesUsed, ['naming-conventions.md', 'error-handling.md']);
            assert.deepStrictEqual(process.codeReviewMetadata?.diffStats, { files: 5, additions: 100, deletions: 20 });
        });

        test('registers pending changes review', () => {
            const data: CodeReviewProcessData = {
                reviewType: 'pending',
                rulesUsed: ['security.md'],
                diffStats: { files: 2, additions: 50, deletions: 10 }
            };

            const id = adapter.registerProcess('Pending review', data);
            const process = adapter.getProcess(id);

            assert.ok(process);
            assert.strictEqual(process.codeReviewMetadata?.reviewType, 'pending');
            assert.strictEqual(process.codeReviewMetadata?.commitSha, undefined);
        });

        test('registers staged changes review', () => {
            const data: CodeReviewProcessData = {
                reviewType: 'staged',
                rulesUsed: ['performance.md', 'testing.md']
            };

            const id = adapter.registerProcess('Staged review', data);
            const process = adapter.getProcess(id);

            assert.ok(process);
            assert.strictEqual(process.codeReviewMetadata?.reviewType, 'staged');
        });

        test('generates unique process IDs', () => {
            const ids = new Set<string>();
            
            for (let i = 0; i < 10; i++) {
                const id = adapter.registerProcess(
                    `Review ${i}`,
                    { reviewType: 'pending', rulesUsed: ['rule.md'] }
                );
                ids.add(id);
            }

            assert.strictEqual(ids.size, 10);
        });

        test('process starts with running status', () => {
            const id = adapter.registerProcess(
                'Test',
                { reviewType: 'commit', rulesUsed: [] }
            );
            const process = adapter.getProcess(id);

            assert.strictEqual(process?.status, 'running');
        });

        test('process has start time', () => {
            const before = new Date();
            const id = adapter.registerProcess(
                'Test',
                { reviewType: 'commit', rulesUsed: [] }
            );
            const after = new Date();
            
            const process = adapter.getProcess(id);
            assert.ok(process?.startTime);
            assert.ok(process.startTime >= before);
            assert.ok(process.startTime <= after);
        });
    });

    // ========================================================================
    // Group Management Tests
    // ========================================================================

    suite('Group Management', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('creates group with correct metadata', () => {
            const id = adapter.registerGroup({
                reviewType: 'commit',
                commitSha: 'group-sha',
                commitMessage: 'Group commit',
                rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md'],
                diffStats: { files: 10, additions: 200, deletions: 50 }
            });

            const process = adapter.getProcess(id);
            assert.ok(process);
            assert.strictEqual(process.type, 'code-review-group');
            assert.ok(process.codeReviewGroupMetadata);
            assert.strictEqual(process.codeReviewGroupMetadata.reviewType, 'commit');
            assert.strictEqual(process.codeReviewGroupMetadata.commitSha, 'group-sha');
        });

        test('child processes are linked to parent group', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const childId1 = adapter.registerProcess(
                'Rule 1 review',
                { reviewType: 'pending', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            const childId2 = adapter.registerProcess(
                'Rule 2 review',
                { reviewType: 'pending', rulesUsed: ['rule2.md'] },
                undefined,
                groupId
            );

            // Verify parent-child relationship
            const children = adapter.getChildProcesses(groupId);
            assert.strictEqual(children.length, 2);

            const childIds = children.map(c => c.id);
            assert.ok(childIds.includes(childId1));
            assert.ok(childIds.includes(childId2));
        });

        test('child processes have parentProcessId', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'staged',
                rulesUsed: ['rule.md']
            });

            const childId = adapter.registerProcess(
                'Child',
                { reviewType: 'staged', rulesUsed: ['rule.md'] },
                undefined,
                groupId
            );

            const child = adapter.getProcess(childId);
            assert.strictEqual(child?.parentProcessId, groupId);
        });

        test('group starts with empty childProcessIds', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'commit',
                rulesUsed: ['rule.md']
            });

            const children = adapter.getChildProcesses(groupId);
            assert.strictEqual(children.length, 0);
        });

        test('adding multiple children updates group metadata', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'pending',
                rulesUsed: ['r1.md', 'r2.md', 'r3.md']
            });

            for (let i = 1; i <= 3; i++) {
                adapter.registerProcess(
                    `Rule ${i}`,
                    { reviewType: 'pending', rulesUsed: [`r${i}.md`] },
                    undefined,
                    groupId
                );
            }

            const children = adapter.getChildProcesses(groupId);
            assert.strictEqual(children.length, 3);
        });

        test('getChildProcesses returns actual process objects', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'commit',
                rulesUsed: ['rule.md']
            });

            adapter.registerProcess(
                'Detailed prompt for child',
                { reviewType: 'commit', commitSha: 'child-sha', rulesUsed: ['rule.md'] },
                undefined,
                groupId
            );

            const children = adapter.getChildProcesses(groupId);
            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].type, 'code-review');
            assert.strictEqual(children[0].codeReviewMetadata?.commitSha, 'child-sha');
        });
    });

    // ========================================================================
    // Completion Flow Tests
    // ========================================================================

    suite('Completion Flow', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('mockCompleteProcess sets status to completed', () => {
            const id = adapter.registerProcess(
                'Complete me',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            mockManager.mockCompleteProcess(id, 'Review completed successfully');

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.status, 'completed');
            assert.strictEqual(process?.result, 'Review completed successfully');
        });

        test('mockCompleteProcess sets end time', () => {
            const id = adapter.registerProcess(
                'Complete me',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            const before = new Date();
            mockManager.mockCompleteProcess(id, 'Done');
            const after = new Date();

            const process = adapter.getProcess(id);
            assert.ok(process?.endTime);
            assert.ok(process.endTime >= before);
            assert.ok(process.endTime <= after);
        });

        test('mockCompleteProcess with structured result', () => {
            const id = adapter.registerProcess(
                'With structured',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            const structuredResult = JSON.stringify({
                findings: [
                    { id: '1', severity: 'error', description: 'Missing null check' },
                    { id: '2', severity: 'warning', description: 'Consider using const' }
                ],
                assessment: 'fail'
            });

            mockManager.mockCompleteProcess(id, 'Found issues', structuredResult);

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.result, 'Found issues');
            assert.strictEqual(process?.structuredResult, structuredResult);
        });

        test('completeGroup updates group status and stores execution stats', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'pending',
                rulesUsed: ['r1.md', 'r2.md', 'r3.md']
            });

            adapter.completeGroup(
                groupId,
                'All rules reviewed',
                JSON.stringify({ summary: 'No issues found' }),
                {
                    totalRules: 3,
                    successfulRules: 3,
                    failedRules: 0,
                    totalTimeMs: 1500
                }
            );

            const process = adapter.getProcess(groupId);
            assert.strictEqual(process?.status, 'completed');
            assert.strictEqual(process?.result, 'All rules reviewed');
            assert.ok(process?.codeReviewGroupMetadata?.executionStats);
            assert.strictEqual(process.codeReviewGroupMetadata.executionStats.totalRules, 3);
        });

        test('updateProcess via adapter updates status and result', () => {
            const id = adapter.registerProcess(
                'Update test',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            adapter.updateProcess(id, 'completed', 'Adapter completion');

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.status, 'completed');
            assert.strictEqual(process?.result, 'Adapter completion');
        });

        test('updateStructuredResult updates only structured result', () => {
            const id = adapter.registerProcess(
                'Structured update',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            const structured = JSON.stringify({ key: 'value' });
            adapter.updateStructuredResult(id, structured);

            const process = adapter.getProcess(id);
            // Status should remain running
            assert.strictEqual(process?.status, 'running');
            assert.strictEqual(process?.structuredResult, structured);
        });

        test('completing children before group', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'commit',
                rulesUsed: ['r1.md', 'r2.md']
            });

            const child1 = adapter.registerProcess(
                'Child 1',
                { reviewType: 'commit', rulesUsed: ['r1.md'] },
                undefined,
                groupId
            );

            const child2 = adapter.registerProcess(
                'Child 2',
                { reviewType: 'commit', rulesUsed: ['r2.md'] },
                undefined,
                groupId
            );

            // Complete children
            mockManager.mockCompleteProcess(child1, 'Child 1 done');
            mockManager.mockCompleteProcess(child2, 'Child 2 done');

            // Verify children completed
            const children = adapter.getChildProcesses(groupId);
            assert.ok(children.every(c => c.status === 'completed'));

            // Group still running
            const group = adapter.getProcess(groupId);
            assert.strictEqual(group?.status, 'running');

            // Complete group
            adapter.completeGroup(groupId, 'All done', '{}', {
                totalRules: 2, successfulRules: 2, failedRules: 0, totalTimeMs: 200
            });

            const completedGroup = adapter.getProcess(groupId);
            assert.strictEqual(completedGroup?.status, 'completed');
        });
    });

    // ========================================================================
    // Error Scenarios Tests
    // ========================================================================

    suite('Error Scenarios', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('mockFailProcess sets status to failed', () => {
            const id = adapter.registerProcess(
                'Fail me',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            mockManager.mockFailProcess(id, 'AI service unavailable');

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.status, 'failed');
            assert.strictEqual(process?.error, 'AI service unavailable');
        });

        test('mockFailProcess sets end time', () => {
            const id = adapter.registerProcess(
                'Fail with time',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            mockManager.mockFailProcess(id, 'Error');

            const process = adapter.getProcess(id);
            assert.ok(process?.endTime);
        });

        test('updateProcess with failed status and error', () => {
            const id = adapter.registerProcess(
                'Adapter fail',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            adapter.updateProcess(id, 'failed', undefined, 'Parsing error');

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.status, 'failed');
            assert.strictEqual(process?.error, 'Parsing error');
        });

        test('child process failure does not fail parent', () => {
            const groupId = adapter.registerGroup({
                reviewType: 'pending',
                rulesUsed: ['r1.md', 'r2.md']
            });

            const child1 = adapter.registerProcess(
                'Will fail',
                { reviewType: 'pending', rulesUsed: ['r1.md'] },
                undefined,
                groupId
            );

            const child2 = adapter.registerProcess(
                'Will succeed',
                { reviewType: 'pending', rulesUsed: ['r2.md'] },
                undefined,
                groupId
            );

            mockManager.mockFailProcess(child1, 'Rule check failed');
            mockManager.mockCompleteProcess(child2, 'Success');

            // Verify child statuses
            const failed = adapter.getProcess(child1);
            const succeeded = adapter.getProcess(child2);
            assert.strictEqual(failed?.status, 'failed');
            assert.strictEqual(succeeded?.status, 'completed');

            // Parent still running
            const group = adapter.getProcess(groupId);
            assert.strictEqual(group?.status, 'running');

            // Can complete group with partial failure stats
            adapter.completeGroup(groupId, 'Partial success', '{}', {
                totalRules: 2, successfulRules: 1, failedRules: 1, totalTimeMs: 100
            });

            const completedGroup = adapter.getProcess(groupId);
            assert.strictEqual(completedGroup?.status, 'completed');
            assert.strictEqual(completedGroup?.codeReviewGroupMetadata?.executionStats?.failedRules, 1);
        });

        test('mockCompleteProcess throws for non-existent ID', () => {
            assert.throws(() => {
                mockManager.mockCompleteProcess('does-not-exist', 'Result');
            }, /Process does-not-exist not found/);
        });

        test('mockFailProcess throws for non-existent ID', () => {
            assert.throws(() => {
                mockManager.mockFailProcess('does-not-exist', 'Error');
            }, /Process does-not-exist not found/);
        });

        test('getProcess returns undefined for non-existent ID', () => {
            const process = adapter.getProcess('no-such-process');
            assert.strictEqual(process, undefined);
        });

        test('getChildProcesses returns empty array for non-existent group', () => {
            const children = adapter.getChildProcesses('no-such-group');
            assert.deepStrictEqual(children, []);
        });
    });

    // ========================================================================
    // Call Verification Tests
    // ========================================================================

    suite('Call Verification', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('getCalls() captures registration calls with arguments', () => {
            adapter.registerProcess(
                'Specific prompt text',
                {
                    reviewType: 'commit',
                    commitSha: 'captured-sha',
                    rulesUsed: ['captured-rule.md']
                }
            );

            const calls = mockManager.getCalls();
            const registerCall = calls.find(c => c.method === 'registerCodeReviewProcess');

            assert.ok(registerCall);
            assert.strictEqual(registerCall.args[0], 'Specific prompt text');
            assert.strictEqual(registerCall.args[1].commitSha, 'captured-sha');
        });

        test('getCalls() captures update calls in order', () => {
            const id = adapter.registerProcess(
                'Track updates',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            adapter.updateProcess(id, 'completed', 'First update');
            adapter.updateStructuredResult(id, '{"key": "value"}');

            const calls = mockManager.getCalls();
            const methodNames = calls.map(c => c.method);

            const registerIndex = methodNames.indexOf('registerCodeReviewProcess');
            const updateIndex = methodNames.indexOf('updateProcess');
            const structuredIndex = methodNames.indexOf('updateProcessStructuredResult');

            assert.ok(registerIndex < updateIndex);
            assert.ok(updateIndex < structuredIndex);
        });

        test('getCallsForMethod() filters correctly', () => {
            // Create group and children
            adapter.registerGroup({ reviewType: 'pending', rulesUsed: ['r1.md', 'r2.md'] });
            adapter.registerProcess('P1', { reviewType: 'pending', rulesUsed: ['r1.md'] });
            adapter.registerProcess('P2', { reviewType: 'pending', rulesUsed: ['r2.md'] });

            const groupCalls = mockManager.getCallsForMethod('registerCodeReviewGroup');
            const processCalls = mockManager.getCallsForMethod('registerCodeReviewProcess');

            assert.strictEqual(groupCalls.length, 1);
            assert.strictEqual(processCalls.length, 2);
        });

        test('getCallsForProcess() tracks all operations on a process', () => {
            const id = adapter.registerProcess(
                'Tracked process',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            adapter.updateProcess(id, 'running', 'Still going');
            adapter.updateStructuredResult(id, '{}');
            adapter.updateProcess(id, 'completed', 'Done');

            const processCalls = mockManager.getCallsForProcess(id);
            const methods = processCalls.map(c => c.method);

            assert.ok(methods.includes('registerCodeReviewProcess'));
            assert.ok(methods.includes('updateProcess'));
            assert.ok(methods.includes('updateProcessStructuredResult'));
        });

        test('calls include timestamps', () => {
            const before = new Date();
            
            adapter.registerProcess(
                'Timed',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            const after = new Date();

            const calls = mockManager.getCalls();
            const call = calls[calls.length - 1];

            assert.ok(call.timestamp >= before);
            assert.ok(call.timestamp <= after);
        });

        test('clearCalls() removes all call history', () => {
            adapter.registerProcess('P1', { reviewType: 'commit', rulesUsed: [] });
            adapter.registerProcess('P2', { reviewType: 'commit', rulesUsed: [] });

            assert.ok(mockManager.getCalls().length > 0);

            mockManager.clearCalls();

            assert.strictEqual(mockManager.getCalls().length, 0);
        });

        test('reset() clears both processes and calls', () => {
            adapter.registerProcess('P1', { reviewType: 'commit', rulesUsed: [] });

            assert.ok(mockManager.getProcesses().length > 0);
            assert.ok(mockManager.getCalls().length > 0);

            mockManager.reset();

            assert.strictEqual(mockManager.getProcesses().length, 0);
            assert.strictEqual(mockManager.getCalls().length, 0);
        });

        test('verify exact sequence of calls for a workflow', () => {
            // Simulate a typical code review workflow
            const groupId = adapter.registerGroup({
                reviewType: 'commit',
                commitSha: 'workflow-sha',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const child1 = adapter.registerProcess(
                'Rule 1',
                { reviewType: 'commit', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            const child2 = adapter.registerProcess(
                'Rule 2',
                { reviewType: 'commit', rulesUsed: ['rule2.md'] },
                undefined,
                groupId
            );

            mockManager.mockCompleteProcess(child1, 'Rule 1 passed');
            mockManager.mockCompleteProcess(child2, 'Rule 2 passed');

            adapter.completeGroup(groupId, 'All passed', '{}', {
                totalRules: 2, successfulRules: 2, failedRules: 0, totalTimeMs: 500
            });

            const calls = mockManager.getCalls();
            const methods = calls.map(c => c.method);

            // Verify expected sequence
            assert.strictEqual(methods[0], 'registerCodeReviewGroup');
            assert.strictEqual(methods[1], 'registerCodeReviewProcess');
            assert.strictEqual(methods[2], 'registerCodeReviewProcess');
            // mockCompleteProcess doesn't show in calls (internal mock method)
            assert.ok(methods.includes('completeCodeReviewGroup'));
        });
    });

    // ========================================================================
    // Process Tracker Integration Tests
    // ========================================================================

    suite('Process Tracker Integration', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('createCodeReviewProcessTracker works with mock adapter', () => {
            const metadata: CodeReviewMetadata = {
                type: 'commit',
                commitSha: 'tracker-sha',
                commitMessage: 'Tracker test',
                rulesUsed: ['rule.md']
            };

            const tracker = createCodeReviewProcessTracker(adapter, metadata);

            // Verify tracker interface
            assert.ok(typeof tracker.registerProcess === 'function');
            assert.ok(typeof tracker.updateProcess === 'function');
            assert.ok(typeof tracker.registerGroup === 'function');
            assert.ok(typeof tracker.completeGroup === 'function');
            assert.ok(typeof tracker.updateGroupStructuredResult === 'function');
        });

        test('tracker.registerGroup sets groupId', () => {
            const metadata: CodeReviewMetadata = {
                type: 'pending',
                rulesUsed: []
            };

            const tracker = createCodeReviewProcessTracker(adapter, metadata);
            assert.strictEqual(tracker.groupId, undefined);

            const groupId = tracker.registerGroup('Test group');
            assert.strictEqual(tracker.groupId, groupId);
        });

        test('tracker passes metadata to registered processes', () => {
            const metadata: CodeReviewMetadata = {
                type: 'staged',
                rulesUsed: [],
                diffStats: { files: 3, additions: 30, deletions: 10 }
            };

            const tracker = createCodeReviewProcessTracker(adapter, metadata);
            const groupId = tracker.registerGroup('With metadata');
            const processId = tracker.registerProcess('Process', groupId);

            const process = adapter.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.codeReviewMetadata?.reviewType, 'staged');
            assert.deepStrictEqual(process.codeReviewMetadata?.diffStats, { files: 3, additions: 30, deletions: 10 });
        });

        test('tracker.updateProcess updates status correctly', () => {
            const metadata: CodeReviewMetadata = { type: 'commit', rulesUsed: [] };
            const tracker = createCodeReviewProcessTracker(adapter, metadata);
            const processId = tracker.registerProcess('Update me');

            tracker.updateProcess(processId, 'completed', 'Done', undefined, '{"result": "pass"}');

            const process = adapter.getProcess(processId);
            assert.strictEqual(process?.status, 'completed');
            assert.strictEqual(process?.result, 'Done');
        });

        test('tracker.updateGroupStructuredResult updates group', () => {
            const metadata: CodeReviewMetadata = { type: 'pending', rulesUsed: [] };
            const tracker = createCodeReviewProcessTracker(adapter, metadata);
            tracker.registerGroup('Group');

            const structured = JSON.stringify({ summary: 'test' });
            tracker.updateGroupStructuredResult(structured);

            const group = adapter.getProcess(tracker.groupId!);
            assert.strictEqual(group?.structuredResult, structured);
        });

        test('tracker.completeGroup with execution stats', () => {
            const metadata: CodeReviewMetadata = { type: 'commit', rulesUsed: [] };
            const tracker = createCodeReviewProcessTracker(adapter, metadata);
            const groupId = tracker.registerGroup('Complete me');

            tracker.completeGroup(groupId, 'Summary', {
                totalItems: 5,
                successfulMaps: 4,
                failedMaps: 1,
                mapPhaseTimeMs: 1000,
                reducePhaseTimeMs: 100,
                maxConcurrency: 3
            });

            const group = adapter.getProcess(groupId);
            assert.strictEqual(group?.status, 'completed');
            assert.strictEqual(group?.result, 'Summary');
            assert.strictEqual(group?.codeReviewGroupMetadata?.executionStats?.totalRules, 5);
            assert.strictEqual(group?.codeReviewGroupMetadata?.executionStats?.successfulRules, 4);
        });
    });

    // ========================================================================
    // Auto-Complete/Auto-Fail Configuration Tests
    // ========================================================================

    suite('Mock Configuration Scenarios', () => {
        test('auto-complete scenario completes processes automatically', async () => {
            const mockManager = new MockAIProcessManager({ autoComplete: true });
            const adapter = new CodeReviewProcessAdapter(mockManager, false);

            const id = adapter.registerProcess(
                'Auto complete',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            // Wait for auto-complete (uses setImmediate)
            await new Promise(resolve => setImmediate(resolve));

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.status, 'completed');
            assert.strictEqual(process?.result, 'Mock result'); // default result

            mockManager.dispose();
        });

        test('auto-fail scenario fails processes automatically', async () => {
            const mockManager = new MockAIProcessManager({ autoFail: true });
            const adapter = new CodeReviewProcessAdapter(mockManager, false);

            const id = adapter.registerProcess(
                'Auto fail',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            // Wait for auto-fail
            await new Promise(resolve => setImmediate(resolve));

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.status, 'failed');
            assert.strictEqual(process?.error, 'Mock error'); // default error

            mockManager.dispose();
        });

        test('custom default result for auto-complete', async () => {
            const mockManager = new MockAIProcessManager({
                autoComplete: true,
                defaultResult: 'Custom auto-complete result'
            });
            const adapter = new CodeReviewProcessAdapter(mockManager, false);

            const id = adapter.registerProcess(
                'Custom result',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            await new Promise(resolve => setImmediate(resolve));

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.result, 'Custom auto-complete result');

            mockManager.dispose();
        });

        test('custom default error for auto-fail', async () => {
            const mockManager = new MockAIProcessManager({
                autoFail: true,
                defaultError: 'Custom error message'
            });
            const adapter = new CodeReviewProcessAdapter(mockManager, false);

            const id = adapter.registerProcess(
                'Custom error',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            await new Promise(resolve => setImmediate(resolve));

            const process = adapter.getProcess(id);
            assert.strictEqual(process?.error, 'Custom error message');

            mockManager.dispose();
        });

        test('configure() changes behavior after construction', async () => {
            const mockManager = createMockAIProcessManager(); // default: no auto-complete
            const adapter = new CodeReviewProcessAdapter(mockManager, false);

            // First process - manual
            const id1 = adapter.registerProcess(
                'Manual',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            await new Promise(resolve => setImmediate(resolve));
            assert.strictEqual(adapter.getProcess(id1)?.status, 'running');

            // Enable auto-complete
            mockManager.configure({ autoComplete: true });

            // Second process - auto-complete
            const id2 = adapter.registerProcess(
                'Auto',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            await new Promise(resolve => setImmediate(resolve));
            assert.strictEqual(adapter.getProcess(id2)?.status, 'completed');

            mockManager.dispose();
        });
    });

    // ========================================================================
    // Event Handling Tests
    // ========================================================================

    suite('Event Handling', () => {
        let mockManager: MockAIProcessManager;
        let adapter: CodeReviewProcessAdapter;

        setup(() => {
            mockManager = createMockAIProcessManager();
            adapter = new CodeReviewProcessAdapter(mockManager, false);
        });

        teardown(() => {
            mockManager.dispose();
        });

        test('onDidChangeProcesses fires on process registration', () => {
            const events: any[] = [];
            const disposable = mockManager.onDidChangeProcesses(e => events.push(e));

            adapter.registerProcess(
                'Event test',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].type, 'process-added');

            disposable.dispose();
        });

        test('onDidChangeProcesses fires on process update', () => {
            const events: any[] = [];
            
            const id = adapter.registerProcess(
                'Update event',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            const disposable = mockManager.onDidChangeProcesses(e => events.push(e));
            
            adapter.updateProcess(id, 'completed', 'Done');

            assert.ok(events.some(e => e.type === 'process-updated'));

            disposable.dispose();
        });

        test('onDidChangeProcesses fires on mockCompleteProcess', () => {
            const events: any[] = [];
            
            const id = adapter.registerProcess(
                'Complete event',
                { reviewType: 'commit', rulesUsed: ['rule.md'] }
            );

            const disposable = mockManager.onDidChangeProcesses(e => events.push(e));
            
            mockManager.mockCompleteProcess(id, 'Completed');

            assert.ok(events.some(e => e.type === 'process-updated'));

            disposable.dispose();
        });

        test('onDidChangeProcesses fires on clearAllProcesses', () => {
            const events: any[] = [];
            
            adapter.registerProcess('P1', { reviewType: 'commit', rulesUsed: [] });
            adapter.registerProcess('P2', { reviewType: 'commit', rulesUsed: [] });

            const disposable = mockManager.onDidChangeProcesses(e => events.push(e));
            
            mockManager.clearAllProcesses();

            assert.ok(events.some(e => e.type === 'processes-cleared'));

            disposable.dispose();
        });
    });
});
