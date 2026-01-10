/**
 * Tests for Code Review Reducers
 * 
 * Tests the code review functionality using the map-reduce framework.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    createCodeReviewJob,
    DeterministicReducer,
    createDeterministicReducer,
    MapResult,
    ReduceContext as MRReduceContext,
    Rule,
    RuleReviewResult,
    ReviewFinding as MRReviewFinding,
    ReviewSeverity,
    CodeReviewInput,
    CodeReviewOutput,
    AIInvoker,
    createExecutor
} from '../../shortcuts/map-reduce';
import { aggregateReviewResults } from '../../shortcuts/code-review/response-parser';
import {
    CodeReviewMetadata,
    SingleRuleReviewResult,
    CodeRule,
    ReviewFinding
} from '../../shortcuts/code-review/types';

// Helper to create test rules
function createTestRule(filename: string, content: string = ''): CodeRule {
    return {
        filename,
        path: `/rules/${filename}`,
        content
    };
}

// Helper to create test rule for map-reduce
function createMRTestRule(filename: string, content: string = ''): Rule {
    return {
        id: filename.replace(/\.[^/.]+$/, ''),
        filename,
        path: `/rules/${filename}`,
        content
    };
}

suite('Code Review aggregateReviewResults (Legacy)', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'commit',
        commitSha: 'abc123',
        rulesUsed: []
    };

    test('returns empty result for empty rule results', () => {
        const result = aggregateReviewResults([], defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.summary.totalFindings, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
        assert.strictEqual(result.reduceStats?.originalCount, 0);
        assert.strictEqual(result.reduceStats?.dedupedCount, 0);
        assert.strictEqual(result.reduceStats?.usedAIReduce, false);
    });

    test('collects findings from successful rule results', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Issue 1', file: 'src/a.ts', line: 10 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'warning', rule: 'rule2.md', description: 'Issue 2', file: 'src/b.ts', line: 20 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 2);
        assert.strictEqual(result.reduceStats?.originalCount, 2);
        assert.strictEqual(result.reduceStats?.dedupedCount, 2);
        assert.strictEqual(result.reduceStats?.mergedCount, 0);
    });

    test('ignores findings from failed rule results', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Issue 1' }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: false,
                error: 'Failed',
                findings: [
                    { id: 'f2', severity: 'warning', rule: 'rule2.md', description: 'Issue 2' }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].rule, 'rule1.md');
    });

    test('deduplicates findings with same file, line, and description', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Bad naming', file: 'src/test.ts', line: 10 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'error', rule: 'rule2.md', description: 'Bad naming', file: 'src/test.ts', line: 10 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        // Should deduplicate to 1 finding, keeping the more severe one
        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].severity, 'error'); // Higher severity kept
        assert.strictEqual(result.reduceStats?.mergedCount, 1);
    });

    test('does not deduplicate findings with different descriptions', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Issue A', file: 'src/test.ts', line: 10 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'error', rule: 'rule2.md', description: 'Issue B', file: 'src/test.ts', line: 10 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 2);
    });

    test('sorts findings by severity (errors first)', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
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

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings[0].severity, 'error');
        assert.strictEqual(result.findings[1].severity, 'warning');
        assert.strictEqual(result.findings[2].severity, 'info');
        assert.strictEqual(result.findings[3].severity, 'suggestion');
    });

    test('sorts findings by file then line within same severity', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1', description: 'A', file: 'src/b.ts', line: 20 },
                    { id: 'f2', severity: 'error', rule: 'rule1', description: 'B', file: 'src/a.ts', line: 30 },
                    { id: 'f3', severity: 'error', rule: 'rule1', description: 'C', file: 'src/a.ts', line: 10 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings[0].file, 'src/a.ts');
        assert.strictEqual(result.findings[0].line, 10);
        assert.strictEqual(result.findings[1].file, 'src/a.ts');
        assert.strictEqual(result.findings[1].line, 30);
        assert.strictEqual(result.findings[2].file, 'src/b.ts');
    });

    test('creates correct summary with errors', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'rule1.md', description: 'Error' },
                    { id: 'f2', severity: 'warning', rule: 'rule1.md', description: 'Warning' }
                ],
                assessment: 'fail'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.summary.totalFindings, 2);
        assert.strictEqual(result.summary.bySeverity.error, 1);
        assert.strictEqual(result.summary.bySeverity.warning, 1);
        assert.strictEqual(result.summary.overallAssessment, 'fail');
        assert.ok(result.summary.summaryText.includes('2 issue'));
    });

    test('creates correct summary with warnings only', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1.md', description: 'Warning' }
                ],
                assessment: 'needs-attention'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.summary.overallAssessment, 'needs-attention');
    });

    test('creates correct summary with no findings', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [],
                assessment: 'pass'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.summary.totalFindings, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
        assert.ok(result.summary.summaryText.includes('No issues'));
    });

    test('tags findings with rule file', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('naming.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'Unknown Rule', description: 'Issue' }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings[0].ruleFile, 'naming.md');
        assert.strictEqual(result.findings[0].rule, 'naming.md');
    });

    test('includes failed rule count in summary', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: []
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: false,
                error: 'Timeout',
                findings: []
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.ok(result.summary.summaryText.includes('1 failed'));
    });

    test('handles findings without file or line', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1.md', description: 'General issue' }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].file, undefined);
        assert.strictEqual(result.findings[0].line, undefined);
    });

    test('merges rule names when deduplicating', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'naming', description: 'Bad name', file: 'src/a.ts', line: 10 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'warning', rule: 'style', description: 'Bad name', file: 'src/a.ts', line: 10 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 1);
        // Rule should contain both names
        assert.ok(result.findings[0].rule.includes('naming') || result.findings[0].rule.includes('style'));
    });

    test('keeps longer suggestion when merging', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
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
                rule: createTestRule('rule2.md'),
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

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.findings.length, 1);
        assert.ok(result.findings[0].suggestion!.length > 20);
    });
});

suite('Map-Reduce Code Review Job', () => {
    // Mock AI invoker that returns successful empty results
    const mockAIInvoker: AIInvoker = async (prompt) => ({
        success: true,
        response: JSON.stringify({
            assessment: 'pass',
            findings: []
        })
    });

    test('creates code review job with correct structure', () => {
        const job = createCodeReviewJob({ aiInvoker: mockAIInvoker });

        assert.strictEqual(job.id, 'code-review');
        assert.strictEqual(job.name, 'Code Review');
        assert.ok(job.splitter);
        assert.ok(job.mapper);
        assert.ok(job.reducer);
    });

    test('code review job can be executed with executor', async () => {
        // Create a mock AI invoker that returns findings
        const mockInvokerWithFindings: AIInvoker = async (prompt) => ({
            success: true,
            response: JSON.stringify({
                assessment: 'needs-attention',
                findings: [
                    {
                        severity: 'warning',
                        file: 'test.ts',
                        line: 10,
                        description: 'Test issue',
                        suggestion: 'Fix it'
                    }
                ]
            })
        });

        const job = createCodeReviewJob({ aiInvoker: mockInvokerWithFindings });
        const executor = createExecutor({
            aiInvoker: mockInvokerWithFindings,
            maxConcurrency: 1,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const input: CodeReviewInput = {
            diff: 'diff --git a/test.ts b/test.ts\n+const x = 1;',
            rules: [createMRTestRule('test-rule.md', 'Test rule content')]
        };

        const result = await executor.execute(job, input);

        assert.ok(result.success || result.executionStats.failedMaps === 0);
        assert.strictEqual(result.executionStats.totalItems, 1);
    });
});

suite('Reducer Edge Cases', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'pending',
        rulesUsed: []
    };

    test('handles findings with null/undefined values', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
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

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 100);

        assert.strictEqual(result.findings.length, 1);
        // Should use rule filename as rule
        assert.strictEqual(result.findings[0].rule, 'rule1.md');
    });

    test('handles very long descriptions for deduplication', () => {
        const longDesc = 'A'.repeat(200);

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: longDesc, file: 'a.ts', line: 1 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'info', rule: 'rule2', description: longDesc, file: 'a.ts', line: 1 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 100);

        // Should deduplicate based on first 100 chars
        assert.strictEqual(result.findings.length, 1);
    });

    test('handles whitespace differences in descriptions', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: '  Bad   naming  ', file: 'a.ts', line: 1 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'info', rule: 'rule2', description: 'Bad naming', file: 'a.ts', line: 1 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 100);

        // Should deduplicate because normalized descriptions match
        assert.strictEqual(result.findings.length, 1);
    });

    test('handles case differences in descriptions', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: 'BAD NAMING', file: 'a.ts', line: 1 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f2', severity: 'info', rule: 'rule2', description: 'bad naming', file: 'a.ts', line: 1 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 100);

        // Should deduplicate because lowercase descriptions match
        assert.strictEqual(result.findings.length, 1);
    });

    test('handles special characters in file paths', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'info', rule: 'rule1', description: 'Issue', file: 'src/components/My Component.tsx', line: 1 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 100);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.findings[0].file, 'src/components/My Component.tsx');
    });

    test('handles Windows-style paths in findings', () => {
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

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 100);

        assert.strictEqual(result.findings.length, 1);
        // Path should be preserved as-is
        assert.strictEqual(result.findings[0].file, 'src\\utils\\helper.ts');
    });
});

suite('ReduceStats', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'pending',
        rulesUsed: []
    };

    test('correctly reports merge count', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: createTestRule('rule1.md'),
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'warning', rule: 'rule1', description: 'Same issue', file: 'a.ts', line: 10 },
                    { id: 'f2', severity: 'info', rule: 'rule1', description: 'Different issue', file: 'a.ts', line: 20 }
                ]
            },
            {
                rule: createTestRule('rule2.md'),
                processId: 'p2',
                success: true,
                findings: [
                    { id: 'f3', severity: 'error', rule: 'rule2', description: 'Same issue', file: 'a.ts', line: 10 },
                    { id: 'f4', severity: 'warning', rule: 'rule2', description: 'Yet another issue', file: 'b.ts', line: 5 }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.strictEqual(result.reduceStats?.originalCount, 4);
        assert.strictEqual(result.reduceStats?.dedupedCount, 3); // One duplicate merged
        assert.strictEqual(result.reduceStats?.mergedCount, 1);
    });
});

suite('DeterministicReducer from Map-Reduce Framework', () => {
    test('can be instantiated with custom options', () => {
        interface TestItem {
            id: string;
            value: number;
            [key: string]: unknown; // Index signature for Deduplicatable
        }

        const reducer = createDeterministicReducer<TestItem>({
            getKey: (item) => item.id,
            merge: (a, b) => a.value > b.value ? a : b,
            sort: (a, b) => b.value - a.value
        });

        assert.ok(reducer);
    });
});
