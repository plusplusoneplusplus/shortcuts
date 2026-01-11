/**
 * Integration tests for Code Review Structured Results
 *
 * Tests the flow of structured results through the map-reduce framework
 * to prevent regressions where clicking on code review processes fails
 * to display results.
 */

import * as assert from 'assert';
import { AIProcessManager, MockAIProcessManager } from '../../shortcuts/ai-service';
import {
    CodeReviewInput,
    CodeReviewOutput,
    createCodeReviewJob,
    createExecutor,
    ExecutorOptions,
    ProcessTracker,
    Rule,
    RuleReviewResult
} from '../../shortcuts/map-reduce';
import {
    CodeReviewMetadata,
    ReviewFinding,
    ReviewSummary,
    serializeCodeReviewResult,
    deserializeCodeReviewResult,
    CodeReviewResult
} from '../../shortcuts/code-review/types';

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
}

class MockExtensionContext {
    globalState = new MockGlobalState();
}

/**
 * Adapter to convert RuleReviewResult to CodeReviewResult format
 * This mirrors the transformation done in code-review-commands.ts
 */
function adaptFinding(mrFinding: {
    id: string;
    severity: 'error' | 'warning' | 'info' | 'suggestion';
    rule: string;
    ruleFile?: string;
    file?: string;
    line?: number;
    description: string;
    codeSnippet?: string;
    suggestion?: string;
    explanation?: string;
}): ReviewFinding {
    return {
        id: mrFinding.id,
        severity: mrFinding.severity,
        rule: mrFinding.rule,
        ruleFile: mrFinding.ruleFile,
        file: mrFinding.file,
        line: mrFinding.line,
        description: mrFinding.description,
        codeSnippet: mrFinding.codeSnippet,
        suggestion: mrFinding.suggestion,
        explanation: mrFinding.explanation
    };
}

function transformRuleReviewResultToCodeReviewResult(
    ruleResult: RuleReviewResult,
    metadata: CodeReviewMetadata
): string {
    const findings = ruleResult.findings?.map(adaptFinding) || [];

    const bySeverity = { error: 0, warning: 0, info: 0, suggestion: 0 };
    for (const f of findings) {
        bySeverity[f.severity]++;
    }

    const summary: ReviewSummary = {
        totalFindings: findings.length,
        bySeverity,
        byRule: { [ruleResult.rule?.filename || 'unknown']: findings.length },
        overallAssessment: ruleResult.assessment || 'pass',
        summaryText: findings.length === 0
            ? 'No issues found.'
            : `Found ${findings.length} issue(s).`
    };

    const codeReviewResult = {
        metadata: {
            type: metadata.type,
            commitSha: metadata.commitSha,
            commitMessage: metadata.commitMessage,
            rulesUsed: [ruleResult.rule?.filename || 'unknown'],
            diffStats: metadata.diffStats
        },
        summary,
        findings,
        rawResponse: ruleResult.rawResponse || '',
        timestamp: new Date().toISOString()
    };

    return JSON.stringify(codeReviewResult);
}

suite('Code Review Structured Result Integration Tests', () => {

    suite('Individual Process Structured Result', () => {

        test('should store and retrieve structured result for individual code review', () => {
            const manager = new MockAIProcessManager();

            const metadata: CodeReviewMetadata = {
                type: 'commit',
                commitSha: 'abc123',
                commitMessage: 'Test commit',
                rulesUsed: ['test-rule.md']
            };

            // Register a code review process
            const processId = manager.registerCodeReviewProcess(
                'Review against test-rule.md',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    commitMessage: 'Test commit',
                    rulesUsed: ['test-rule.md']
                }
            );

            // Simulate the RuleReviewResult from map-reduce
            const ruleReviewResult: RuleReviewResult = {
                rule: { id: 'test-rule', filename: 'test-rule.md', path: '/rules/test-rule.md', content: '# Test Rule' },
                success: true,
                findings: [
                    {
                        id: 'f1',
                        severity: 'warning',
                        rule: 'test-rule.md',
                        ruleFile: 'test-rule.md',
                        file: 'src/test.ts',
                        line: 10,
                        description: 'Test finding'
                    }
                ],
                rawResponse: 'AI response here',
                assessment: 'needs-attention'
            };

            // Transform and store like the adapter does
            const structuredResult = transformRuleReviewResultToCodeReviewResult(ruleReviewResult, metadata);

            // Complete the process and update structured result
            manager.updateProcess(processId, 'completed');
            manager.updateProcessStructuredResult(processId, structuredResult);

            // Verify the process has the structured result
            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.ok(process.structuredResult);

            // Verify the structured result can be deserialized
            const parsed = JSON.parse(process.structuredResult);
            assert.ok(parsed.metadata);
            assert.ok(parsed.summary);
            assert.ok(parsed.findings);
            assert.strictEqual(parsed.findings.length, 1);
            assert.strictEqual(parsed.summary.totalFindings, 1);
            assert.strictEqual(parsed.summary.overallAssessment, 'needs-attention');
        });

        test('should handle code review with no findings', () => {
            const manager = new MockAIProcessManager();

            const metadata: CodeReviewMetadata = {
                type: 'pending',
                rulesUsed: ['clean-rule.md']
            };

            const processId = manager.registerCodeReviewProcess(
                'Review against clean-rule.md',
                {
                    reviewType: 'pending',
                    rulesUsed: ['clean-rule.md']
                }
            );

            const ruleReviewResult: RuleReviewResult = {
                rule: { id: 'clean-rule', filename: 'clean-rule.md', path: '/rules/clean-rule.md', content: '# Clean Rule' },
                success: true,
                findings: [],
                rawResponse: 'No issues found',
                assessment: 'pass'
            };

            const structuredResult = transformRuleReviewResultToCodeReviewResult(ruleReviewResult, metadata);
            manager.updateProcess(processId, 'completed');
            manager.updateProcessStructuredResult(processId, structuredResult);

            const process = manager.getProcess(processId);
            assert.ok(process?.structuredResult);

            const parsed = JSON.parse(process.structuredResult);
            assert.strictEqual(parsed.findings.length, 0);
            assert.strictEqual(parsed.summary.totalFindings, 0);
            assert.strictEqual(parsed.summary.overallAssessment, 'pass');
        });
    });

    suite('Group Process Structured Result', () => {

        test('should store and retrieve aggregated structured result for group', () => {
            const manager = new MockAIProcessManager();

            // Register a group
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                commitMessage: 'Test commit',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            // Register child processes
            const child1 = manager.registerCodeReviewProcess(
                'rule1.md',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md']
                },
                undefined,
                groupId
            );

            const child2 = manager.registerCodeReviewProcess(
                'rule2.md',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule2.md']
                },
                undefined,
                groupId
            );

            // Complete children with structured results
            const childResult1 = JSON.stringify({
                rule: { filename: 'rule1.md' },
                success: true,
                findings: [{ id: 'f1', severity: 'error', description: 'Error 1' }],
                assessment: 'fail'
            });
            manager.updateProcess(child1, 'completed');
            manager.updateProcessStructuredResult(child1, childResult1);

            const childResult2 = JSON.stringify({
                rule: { filename: 'rule2.md' },
                success: true,
                findings: [],
                assessment: 'pass'
            });
            manager.updateProcess(child2, 'completed');
            manager.updateProcessStructuredResult(child2, childResult2);

            // Complete the group with placeholder
            manager.completeCodeReviewGroup(
                groupId,
                'Review complete: 1 issue found',
                '{}', // Placeholder
                { totalRules: 2, successfulRules: 2, failedRules: 0, totalTimeMs: 5000 }
            );

            // Now update with full aggregated result (like the adapter does)
            const aggregatedResult = JSON.stringify({
                metadata: {
                    type: 'commit',
                    commitSha: 'abc123',
                    commitMessage: 'Test commit',
                    rulesUsed: ['rule1.md', 'rule2.md']
                },
                summary: {
                    totalFindings: 1,
                    bySeverity: { error: 1, warning: 0, info: 0, suggestion: 0 },
                    byRule: { 'rule1.md': 1 },
                    overallAssessment: 'fail',
                    summaryText: 'Found 1 issue(s).'
                },
                findings: [{ id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Error 1' }],
                rawResponse: 'Combined responses',
                timestamp: new Date().toISOString(),
                executionStats: {
                    totalRules: 2,
                    successfulRules: 2,
                    failedRules: 0,
                    totalTimeMs: 5000
                },
                ruleResults: [
                    { ruleFilename: 'rule1.md', success: true, findingsCount: 1 },
                    { ruleFilename: 'rule2.md', success: true, findingsCount: 0 }
                ]
            });
            manager.updateProcessStructuredResult(groupId, aggregatedResult);

            // Verify the group has the full structured result
            const group = manager.getProcess(groupId);
            assert.ok(group);
            assert.ok(group.structuredResult);

            const parsed = JSON.parse(group.structuredResult);
            assert.ok(parsed.metadata);
            assert.ok(parsed.summary);
            assert.ok(parsed.findings);
            assert.ok(parsed.executionStats);
            assert.strictEqual(parsed.summary.totalFindings, 1);
            assert.strictEqual(parsed.summary.overallAssessment, 'fail');
        });

        test('should retrieve children with structured results', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const child1 = manager.registerCodeReviewProcess(
                'rule1.md',
                { reviewType: 'pending', rulesUsed: ['rule1.md'] },
                undefined,
                groupId
            );

            const child2 = manager.registerCodeReviewProcess(
                'rule2.md',
                { reviewType: 'pending', rulesUsed: ['rule2.md'] },
                undefined,
                groupId
            );

            // Complete with structured results
            manager.updateProcess(child1, 'completed');
            manager.updateProcessStructuredResult(child1, JSON.stringify({ summary: { totalFindings: 2 } }));

            manager.updateProcess(child2, 'completed');
            manager.updateProcessStructuredResult(child2, JSON.stringify({ summary: { totalFindings: 0 } }));

            // Get children
            const children = manager.getChildProcesses(groupId);
            assert.strictEqual(children.length, 2);

            // Verify each child has structured result
            for (const child of children) {
                assert.ok(child.structuredResult, `Child ${child.id} should have structuredResult`);
            }
        });
    });

    suite('Structured Result Persistence', () => {
        // These tests require real AIProcessManager with MockExtensionContext
        // because they test actual persistence behavior

        test('should persist and restore structured results across reload', async () => {
            const context = new MockExtensionContext();

            // Create and populate first manager
            const manager1 = new AIProcessManager();
            await manager1.initialize(context as never);

            const groupId = manager1.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'xyz789',
                rulesUsed: ['rule.md']
            });

            const childId = manager1.registerCodeReviewProcess(
                'rule.md',
                { reviewType: 'commit', commitSha: 'xyz789', rulesUsed: ['rule.md'] },
                undefined,
                groupId
            );

            // Complete with structured results
            const childStructuredResult = JSON.stringify({
                metadata: { type: 'commit', rulesUsed: ['rule.md'] },
                summary: { totalFindings: 3, overallAssessment: 'needs-attention' },
                findings: [
                    { id: 'f1', severity: 'warning', description: 'Warning 1' },
                    { id: 'f2', severity: 'warning', description: 'Warning 2' },
                    { id: 'f3', severity: 'info', description: 'Info 1' }
                ]
            });
            manager1.updateProcess(childId, 'completed');
            manager1.updateProcessStructuredResult(childId, childStructuredResult);

            const groupStructuredResult = JSON.stringify({
                metadata: { type: 'commit', commitSha: 'xyz789', rulesUsed: ['rule.md'] },
                summary: { totalFindings: 3, overallAssessment: 'needs-attention' },
                findings: [
                    { id: 'f1', severity: 'warning' },
                    { id: 'f2', severity: 'warning' },
                    { id: 'f3', severity: 'info' }
                ],
                executionStats: { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 2000 }
            });
            manager1.completeCodeReviewGroup(groupId, 'Done', '{}', { totalRules: 1, successfulRules: 1, failedRules: 0, totalTimeMs: 2000 });
            manager1.updateProcessStructuredResult(groupId, groupStructuredResult);

            // Create second manager and reload
            const manager2 = new AIProcessManager();
            await manager2.initialize(context as never);

            // Verify group is restored with structured result
            const restoredGroup = manager2.getProcess(groupId);
            assert.ok(restoredGroup);
            assert.ok(restoredGroup.structuredResult, 'Group should have structuredResult after reload');

            const parsedGroup = JSON.parse(restoredGroup.structuredResult);
            assert.strictEqual(parsedGroup.summary.totalFindings, 3);

            // Verify child is restored with structured result
            const restoredChild = manager2.getProcess(childId);
            assert.ok(restoredChild);
            assert.ok(restoredChild.structuredResult, 'Child should have structuredResult after reload');

            const parsedChild = JSON.parse(restoredChild.structuredResult);
            assert.strictEqual(parsedChild.findings.length, 3);
        });
    });

    suite('ProcessTracker Integration', () => {

        test('ProcessTracker updateProcess with structuredResult parameter', () => {
            const manager = new MockAIProcessManager();

            const metadata: CodeReviewMetadata = {
                type: 'staged',
                rulesUsed: ['rule.md']
            };

            // Simulate the ExtendedProcessTracker from code-review-commands.ts
            let trackedGroupId: string | undefined;

            const tracker: ProcessTracker & {
                groupId?: string;
                updateGroupStructuredResult(result: string): void;
            } = {
                groupId: undefined,

                registerProcess(description: string, parentGroupId?: string): string {
                    return manager.registerCodeReviewProcess(
                        description,
                        { reviewType: metadata.type, rulesUsed: [] },
                        undefined,
                        parentGroupId
                    );
                },

                updateProcess(
                    processId: string,
                    status: 'running' | 'completed' | 'failed',
                    response?: string,
                    error?: string,
                    structuredResult?: string
                ): void {
                    manager.updateProcess(processId, status, response, error);

                    if (structuredResult && status === 'completed') {
                        // Transform to CodeReviewResult format
                        try {
                            const ruleResult = JSON.parse(structuredResult) as RuleReviewResult;
                            const transformed = transformRuleReviewResultToCodeReviewResult(ruleResult, metadata);
                            manager.updateProcessStructuredResult(processId, transformed);
                        } catch {
                            manager.updateProcessStructuredResult(processId, structuredResult);
                        }
                    }
                },

                registerGroup(description: string): string {
                    const id = manager.registerCodeReviewGroup({
                        reviewType: metadata.type,
                        rulesUsed: []
                    });
                    tracker.groupId = id;
                    trackedGroupId = id;
                    return id;
                },

                completeGroup(groupId: string, summary: string, stats: { totalItems: number; successfulMaps: number; failedMaps: number; mapPhaseTimeMs: number; reducePhaseTimeMs: number }): void {
                    manager.completeCodeReviewGroup(
                        groupId,
                        summary,
                        JSON.stringify(stats),
                        {
                            totalRules: stats.totalItems,
                            successfulRules: stats.successfulMaps,
                            failedRules: stats.failedMaps,
                            totalTimeMs: stats.mapPhaseTimeMs + stats.reducePhaseTimeMs
                        }
                    );
                },

                updateGroupStructuredResult(structuredResult: string): void {
                    if (tracker.groupId) {
                        manager.updateProcessStructuredResult(tracker.groupId, structuredResult);
                    }
                }
            };

            // Simulate the executor flow
            const groupId = tracker.registerGroup('Code Review');
            const processId = tracker.registerProcess('rule.md', groupId);

            // Simulate map completion with output
            const mapOutput: RuleReviewResult = {
                rule: { id: 'rule', filename: 'rule.md', path: '/rules/rule.md', content: '' },
                success: true,
                findings: [{ id: 'f1', severity: 'error', rule: 'rule.md', description: 'Error found' }],
                rawResponse: 'AI response',
                assessment: 'fail'
            };

            // This is what the executor does
            tracker.updateProcess(processId, 'completed', undefined, undefined, JSON.stringify(mapOutput));

            // Verify the child process has transformed structured result
            const childProcess = manager.getProcess(processId);
            assert.ok(childProcess);
            assert.ok(childProcess.structuredResult);

            const childParsed = JSON.parse(childProcess.structuredResult);
            assert.ok(childParsed.metadata, 'Should have metadata');
            assert.ok(childParsed.summary, 'Should have summary');
            assert.ok(childParsed.findings, 'Should have findings');
            assert.strictEqual(childParsed.summary.totalFindings, 1);

            // Complete group
            tracker.completeGroup(groupId, 'Done', {
                totalItems: 1,
                successfulMaps: 1,
                failedMaps: 0,
                mapPhaseTimeMs: 1000,
                reducePhaseTimeMs: 100,
                maxConcurrency: 5
            });

            // Update with full aggregated result
            const aggregatedResult = JSON.stringify({
                metadata: { type: 'staged', rulesUsed: ['rule.md'] },
                summary: { totalFindings: 1, overallAssessment: 'fail' },
                findings: [{ id: 'f1', severity: 'error', rule: 'rule.md', description: 'Error found' }],
                rawResponse: 'Combined',
                timestamp: new Date().toISOString()
            });
            tracker.updateGroupStructuredResult(aggregatedResult);

            // Verify group has full structured result
            const groupProcess = manager.getProcess(groupId);
            assert.ok(groupProcess);
            assert.ok(groupProcess.structuredResult);

            const groupParsed = JSON.parse(groupProcess.structuredResult);
            assert.ok(groupParsed.metadata);
            assert.ok(groupParsed.summary);
            assert.strictEqual(groupParsed.summary.totalFindings, 1);
        });
    });

    suite('Viewer Compatibility', () => {

        test('structured result should be deserializable by viewer', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerCodeReviewProcess(
                'test rule',
                { reviewType: 'commit', commitSha: 'test123', rulesUsed: ['rule.md'] }
            );

            // Create a proper CodeReviewResult
            const result: CodeReviewResult = {
                metadata: {
                    type: 'commit',
                    commitSha: 'test123',
                    rulesUsed: ['rule.md']
                },
                summary: {
                    totalFindings: 2,
                    bySeverity: { error: 1, warning: 1, info: 0, suggestion: 0 },
                    byRule: { 'rule.md': 2 },
                    overallAssessment: 'fail',
                    summaryText: 'Found 2 issue(s).'
                },
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule.md', description: 'Error' },
                    { id: 'f2', severity: 'warning', rule: 'rule.md', description: 'Warning' }
                ],
                rawResponse: 'AI response',
                timestamp: new Date()
            };

            // Serialize like the code-review-commands.ts does
            const serialized = serializeCodeReviewResult(result);
            const structuredResult = JSON.stringify(serialized);

            manager.updateProcess(processId, 'completed');
            manager.updateProcessStructuredResult(processId, structuredResult);

            // Retrieve and deserialize like the viewer does
            const process = manager.getProcess(processId);
            assert.ok(process?.structuredResult);

            const parsed = JSON.parse(process.structuredResult);
            const deserialized = deserializeCodeReviewResult(parsed);

            // Verify all fields are properly restored
            assert.strictEqual(deserialized.metadata.type, 'commit');
            assert.strictEqual(deserialized.metadata.commitSha, 'test123');
            assert.strictEqual(deserialized.summary.totalFindings, 2);
            assert.strictEqual(deserialized.summary.overallAssessment, 'fail');
            assert.strictEqual(deserialized.findings.length, 2);
            assert.ok(deserialized.timestamp instanceof Date);
        });

        test('group structured result should be compatible with viewer', () => {
            const manager = new MockAIProcessManager();

            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            // Create aggregated result like code-review-commands.ts does
            const aggregatedResult = {
                metadata: {
                    type: 'pending',
                    rulesUsed: ['rule1.md', 'rule2.md']
                },
                summary: {
                    totalFindings: 3,
                    bySeverity: { error: 0, warning: 2, info: 1, suggestion: 0 },
                    byRule: { 'rule1.md': 2, 'rule2.md': 1 },
                    overallAssessment: 'needs-attention',
                    summaryText: 'Found 3 issue(s).'
                },
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Warning 1' },
                    { id: 'f2', severity: 'warning', rule: 'rule1.md', description: 'Warning 2' },
                    { id: 'f3', severity: 'info', rule: 'rule2.md', description: 'Info 1' }
                ],
                rawResponse: 'Combined responses',
                timestamp: new Date().toISOString(),
                executionStats: {
                    totalRules: 2,
                    successfulRules: 2,
                    failedRules: 0,
                    totalTimeMs: 3000
                },
                ruleResults: [
                    { ruleFilename: 'rule1.md', success: true, findingsCount: 2, assessment: 'needs-attention' },
                    { ruleFilename: 'rule2.md', success: true, findingsCount: 1, assessment: 'pass' }
                ]
            };

            manager.completeCodeReviewGroup(groupId, 'Done', '{}', { totalRules: 2, successfulRules: 2, failedRules: 0, totalTimeMs: 3000 });
            manager.updateProcessStructuredResult(groupId, JSON.stringify(aggregatedResult));

            // Retrieve like the viewCodeReviewGroupDetailsCommand does
            const group = manager.getProcess(groupId);
            assert.ok(group?.structuredResult);

            const parsed = JSON.parse(group.structuredResult);

            // Create viewer result like extension.ts does
            const viewerResult = {
                metadata: parsed.metadata,
                summary: parsed.summary,
                findings: parsed.findings,
                rawResponse: parsed.rawResponse,
                timestamp: new Date(parsed.timestamp)
            };

            // Verify viewer result has all required fields
            assert.ok(viewerResult.metadata);
            assert.ok(viewerResult.summary);
            assert.ok(viewerResult.findings);
            assert.strictEqual(viewerResult.summary.totalFindings, 3);
            assert.strictEqual(viewerResult.findings.length, 3);
        });
    });
});
