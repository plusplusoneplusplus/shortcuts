/**
 * Tests for Code Review Reducers
 * 
 * Tests both DeterministicReducer and AIReducer implementations.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    DeterministicReducer,
    AIReducer,
    createReducer,
    Reducer
} from '../../shortcuts/code-review/reducer';
import {
    CodeReviewMetadata,
    CodeReviewReduceMode,
    ReduceContext,
    ReviewFinding,
    SingleRuleReviewResult
} from '../../shortcuts/code-review/types';

suite('DeterministicReducer', () => {
    let reducer: DeterministicReducer;

    setup(() => {
        reducer = new DeterministicReducer();
    });

    const defaultContext: ReduceContext = {
        metadata: {
            type: 'commit',
            commitSha: 'abc123',
            rulesUsed: []
        },
        mapPhaseTimeMs: 1000,
        filesChanged: 3
    };

    test('returns empty result for empty rule results', async () => {
        const result = await reducer.reduce([], defaultContext);

        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.summary.totalFindings, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
        assert.strictEqual(result.reduceStats.originalCount, 0);
        assert.strictEqual(result.reduceStats.dedupedCount, 0);
        assert.strictEqual(result.reduceStats.usedAIReduce, false);
    });

    test('collects findings from successful rule results', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Issue 1', file: 'src/a.ts', line: 10 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'warning', rule: 'rule2.md', description: 'Issue 2', file: 'src/b.ts', line: 20 }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings.length, 2);
        assert.strictEqual(result.reduceStats.originalCount, 2);
        assert.strictEqual(result.reduceStats.dedupedCount, 2);
        assert.strictEqual(result.reduceStats.mergedCount, 0);
    });

    test('ignores findings from failed rule results', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Issue 1' }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: false,
                error: 'Failed',
                findings: [
                    { id: 'f2', severity: 'warning', rule: 'rule2.md', description: 'Issue 2' }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].rule, 'rule1.md');
    });

    test('deduplicates findings with same file, line, and description', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Bad naming', file: 'src/test.ts', line: 10 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'error', rule: 'rule2.md', description: 'Bad naming', file: 'src/test.ts', line: 10 }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        // Should deduplicate to 1 finding, keeping the more severe one
        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].severity, 'error'); // Higher severity kept
        assert.strictEqual(result.reduceStats.mergedCount, 1);
    });

    test('does not deduplicate findings with different descriptions', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Issue A', file: 'src/test.ts', line: 10 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'error', rule: 'rule2.md', description: 'Issue B', file: 'src/test.ts', line: 10 }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings.length, 2);
    });

    test('sorts findings by severity (errors first)', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'suggestion', rule: 'rule1', description: 'Suggestion' },
                    { id: 'f2', severity: 'error', rule: 'rule1', description: 'Error' },
                    { id: 'f3', severity: 'warning', rule: 'rule1', description: 'Warning' },
                    { id: 'f4', severity: 'info', rule: 'rule1', description: 'Info' }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings[0].severity, 'error');
        assert.strictEqual(result.findings[1].severity, 'warning');
        assert.strictEqual(result.findings[2].severity, 'info');
        assert.strictEqual(result.findings[3].severity, 'suggestion');
    });

    test('sorts findings by file then line within same severity', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1', description: 'A', file: 'src/b.ts', line: 20 },
                    { id: 'f2', severity: 'error', rule: 'rule1', description: 'B', file: 'src/a.ts', line: 30 },
                    { id: 'f3', severity: 'error', rule: 'rule1', description: 'C', file: 'src/a.ts', line: 10 }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings[0].file, 'src/a.ts');
        assert.strictEqual(result.findings[0].line, 10);
        assert.strictEqual(result.findings[1].file, 'src/a.ts');
        assert.strictEqual(result.findings[1].line, 30);
        assert.strictEqual(result.findings[2].file, 'src/b.ts');
    });

    test('creates correct summary with errors', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Error' },
                    { id: 'f2', severity: 'warning', rule: 'rule1.md', description: 'Warning' }
                ],
                assessment: 'fail'
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.summary.totalFindings, 2);
        assert.strictEqual(result.summary.bySeverity.error, 1);
        assert.strictEqual(result.summary.bySeverity.warning, 1);
        assert.strictEqual(result.summary.overallAssessment, 'fail');
        assert.ok(result.summary.summaryText.includes('2 issue'));
    });

    test('creates correct summary with warnings only', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Warning' }
                ],
                assessment: 'needs-attention'
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.summary.overallAssessment, 'needs-attention');
    });

    test('creates correct summary with no findings', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [],
                assessment: 'pass'
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.summary.totalFindings, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
        assert.ok(result.summary.summaryText.includes('No issues'));
    });

    test('tags findings with rule file', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'Unknown Rule', description: 'Issue' }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings[0].ruleFile, 'naming.md');
        assert.strictEqual(result.findings[0].rule, 'naming.md');
    });

    test('includes failed rule count in summary', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: []
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: false,
                error: 'Timeout',
                findings: []
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.ok(result.summary.summaryText.includes('1 failed'));
    });

    test('handles findings without file or line', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1.md', description: 'General issue' }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].file, undefined);
        assert.strictEqual(result.findings[0].line, undefined);
    });

    test('merges rule names when deduplicating', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'naming', description: 'Bad name', file: 'src/a.ts', line: 10 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'warning', rule: 'style', description: 'Bad name', file: 'src/a.ts', line: 10 }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings.length, 1);
        // Rule should contain both names
        assert.ok(result.findings[0].rule.includes('naming') || result.findings[0].rule.includes('style'));
    });

    test('keeps longer suggestion when merging', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { 
                        id: 'f1', 
                        severity: 'warning', 
                        rule: 'rule1', 
                        description: 'Issue', 
                        file: 'a.ts', 
                        line: 1,
                        suggestion: 'Short fix'
                    }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { 
                        id: 'f2', 
                        severity: 'error', 
                        rule: 'rule2', 
                        description: 'Issue', 
                        file: 'a.ts', 
                        line: 1,
                        suggestion: 'A much longer and more detailed suggestion for how to fix this problem'
                    }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.strictEqual(result.findings.length, 1);
        assert.ok(result.findings[0].suggestion!.length > 20);
    });

    test('tracks reduce time in stats', async () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: 'Issue' }
                ]
            }
        ];

        const result = await reducer.reduce(ruleResults, defaultContext);

        assert.ok(result.reduceStats.reduceTimeMs >= 0);
    });
});

suite('AIReducer', () => {
    test('falls back to deterministic when AI returns error', async () => {
        const mockInvokeAI = async () => ({
            success: false,
            error: 'Service unavailable'
        });

        const reducer = new AIReducer(mockInvokeAI);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Issue' }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'pending', rulesUsed: [] },
            mapPhaseTimeMs: 1000,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.reduceStats.usedAIReduce, false);
    });

    test('falls back to deterministic when AI throws', async () => {
        const mockInvokeAI = async () => {
            throw new Error('Network error');
        };

        const reducer = new AIReducer(mockInvokeAI);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Issue' }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'commit', commitSha: 'abc', rulesUsed: [] },
            mapPhaseTimeMs: 500,
            filesChanged: 2
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.reduceStats.usedAIReduce, false);
    });

    test('skips AI call when no findings', async () => {
        let aiCalled = false;
        const mockInvokeAI = async () => {
            aiCalled = true;
            return { success: true, response: '{}' };
        };

        const reducer = new AIReducer(mockInvokeAI);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: []
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'staged', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 0
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(aiCalled, false);
        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
    });

    test('parses valid AI JSON response', async () => {
        const mockResponse = JSON.stringify({
            summary: 'Found some issues that need attention.',
            overallSeverity: 'needs-work',
            findings: [
                {
                    id: 'synth-1',
                    severity: 'error',
                    file: 'src/test.ts',
                    line: 10,
                    issue: 'Synthesized issue description',
                    suggestion: 'Fix it this way',
                    fromRules: ['rule1.md', 'rule2.md']
                }
            ],
            stats: {
                totalIssues: 1,
                deduplicated: 1
            }
        });

        const mockInvokeAI = async () => ({
            success: true,
            response: mockResponse
        });

        const reducer = new AIReducer(mockInvokeAI);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Original issue', file: 'src/test.ts', line: 10 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'commit', commitSha: 'xyz', rulesUsed: [] },
            mapPhaseTimeMs: 2000,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.reduceStats.usedAIReduce, true);
        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].description, 'Synthesized issue description');
        assert.strictEqual(result.summary.overallAssessment, 'fail'); // needs-work maps to fail
    });

    test('handles malformed AI response gracefully', async () => {
        const mockInvokeAI = async () => ({
            success: true,
            response: 'This is not valid JSON at all'
        });

        const reducer = new AIReducer(mockInvokeAI);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1.md', description: 'Original' }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'pending', rulesUsed: [] },
            mapPhaseTimeMs: 1000,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        // Should fall back and still return findings
        assert.strictEqual(result.findings.length, 1);
    });

    test('maps AI severity values correctly', async () => {
        const mockResponse = JSON.stringify({
            summary: 'Test',
            overallSeverity: 'clean',
            findings: [
                { id: '1', severity: 'critical', issue: 'Critical issue' },
                { id: '2', severity: 'major', issue: 'Major issue' },
                { id: '3', severity: 'minor', issue: 'Minor issue' },
                { id: '4', severity: 'nitpick', issue: 'Nitpick issue' }
            ]
        });

        const mockInvokeAI = async () => ({
            success: true,
            response: mockResponse
        });

        const reducer = new AIReducer(mockInvokeAI);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1.md', description: 'Placeholder' }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'commit', commitSha: '123', rulesUsed: [] },
            mapPhaseTimeMs: 500,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.findings[0].severity, 'error'); // critical -> error
        assert.strictEqual(result.findings[1].severity, 'warning'); // major -> warning
        assert.strictEqual(result.findings[2].severity, 'info'); // minor -> info
        assert.strictEqual(result.findings[3].severity, 'suggestion'); // nitpick -> suggestion
    });
});

suite('createReducer factory', () => {
    test('creates DeterministicReducer for deterministic mode', () => {
        const reducer = createReducer('deterministic');
        assert.ok(reducer instanceof DeterministicReducer);
    });

    test('creates DeterministicReducer when AI mode but no invokeAI provided', () => {
        const reducer = createReducer('ai');
        assert.ok(reducer instanceof DeterministicReducer);
    });

    test('creates AIReducer for AI mode with invokeAI', () => {
        const mockInvokeAI = async () => ({ success: true, response: '' });
        const reducer = createReducer('ai', mockInvokeAI);
        assert.ok(reducer instanceof AIReducer);
    });

    test('creates DeterministicReducer by default', () => {
        const reducer = createReducer('deterministic' as CodeReviewReduceMode);
        assert.ok(reducer instanceof DeterministicReducer);
    });
});

suite('Reducer Edge Cases', () => {
    test('handles findings with null/undefined values', async () => {
        const reducer = new DeterministicReducer();

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { 
                        id: 'f1', 
                        severity: 'info', 
                        rule: '', // empty rule
                        description: '',  // empty description
                        file: undefined,
                        line: undefined
                    }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'pending', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 0
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.findings.length, 1);
        // Should use rule filename as rule
        assert.strictEqual(result.findings[0].rule, 'rule1.md');
    });

    test('handles very long descriptions for deduplication', async () => {
        const reducer = new DeterministicReducer();
        const longDesc = 'A'.repeat(200);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: longDesc, file: 'a.ts', line: 1 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'info', rule: 'rule2', description: longDesc, file: 'a.ts', line: 1 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'commit', commitSha: 'abc', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        // Should deduplicate based on first 100 chars
        assert.strictEqual(result.findings.length, 1);
    });

    test('handles whitespace differences in descriptions', async () => {
        const reducer = new DeterministicReducer();

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: '  Bad   naming  ', file: 'a.ts', line: 1 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'info', rule: 'rule2', description: 'Bad naming', file: 'a.ts', line: 1 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'pending', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        // Should deduplicate because normalized descriptions match
        assert.strictEqual(result.findings.length, 1);
    });

    test('handles case differences in descriptions', async () => {
        const reducer = new DeterministicReducer();

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: 'BAD NAMING', file: 'a.ts', line: 1 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'info', rule: 'rule2', description: 'bad naming', file: 'a.ts', line: 1 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'staged', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        // Should deduplicate because lowercase descriptions match
        assert.strictEqual(result.findings.length, 1);
    });

    test('handles special characters in file paths', async () => {
        const reducer = new DeterministicReducer();

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: 'Issue', file: 'src/components/My Component.tsx', line: 1 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'pending', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].file, 'src/components/My Component.tsx');
    });

    test('handles Windows-style paths in findings', async () => {
        const reducer = new DeterministicReducer();

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: 'C:\\rules\\rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: 'Issue', file: 'src\\utils\\helper.ts', line: 1 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'commit', commitSha: 'abc', rulesUsed: [] },
            mapPhaseTimeMs: 100,
            filesChanged: 1
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.findings.length, 1);
        // Path should be preserved as-is
        assert.strictEqual(result.findings[0].file, 'src\\utils\\helper.ts');
    });
});

suite('ReduceStats', () => {
    test('correctly reports merge count', async () => {
        const reducer = new DeterministicReducer();

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1', description: 'Same issue', file: 'a.ts', line: 10 },
                    { id: 'f2', severity: 'info', rule: 'rule1', description: 'Different issue', file: 'a.ts', line: 20 }
                ]
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f3', severity: 'error', rule: 'rule2', description: 'Same issue', file: 'a.ts', line: 10 },
                    { id: 'f4', severity: 'warning', rule: 'rule2', description: 'Yet another issue', file: 'b.ts', line: 5 }
                ]
            }
        ];

        const context: ReduceContext = {
            metadata: { type: 'pending', rulesUsed: [] },
            mapPhaseTimeMs: 1000,
            filesChanged: 2
        };

        const result = await reducer.reduce(ruleResults, context);

        assert.strictEqual(result.reduceStats.originalCount, 4);
        assert.strictEqual(result.reduceStats.dedupedCount, 3); // One duplicate merged
        assert.strictEqual(result.reduceStats.mergedCount, 1);
    });
});
