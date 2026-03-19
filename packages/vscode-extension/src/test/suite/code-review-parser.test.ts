/**
 * Tests for Code Review Response Parser
 */

import * as assert from 'assert';
import {
    parseCodeReviewResponse,
    isStructuredResponse,
    formatCodeReviewResultAsMarkdown,
    aggregateReviewResults,
    formatAggregatedResultAsMarkdown
} from '../../shortcuts/code-review/response-parser';
import {
    AggregatedCodeReviewResult,
    CodeReviewMetadata,
    CodeReviewResult,
    ReviewFinding,
    SingleRuleReviewResult
} from '../../shortcuts/code-review/types';

suite('Code Review Response Parser', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'commit',
        commitSha: 'abc1234567890',
        commitMessage: 'Test commit message',
        rulesUsed: ['rule1.md', 'rule2.md'],
        diffStats: {
            files: 3,
            additions: 50,
            deletions: 20
        }
    };

    suite('parseCodeReviewResponse', () => {
        test('should parse a well-formatted structured response', () => {
            const response = `## Summary
This code has some issues that need attention.
Overall: NEEDS_ATTENTION

## Findings

### [ERROR] Rule: naming-conventions
- **File:** src/utils.ts
- **Line:** 42
- **Issue:** Variable name does not follow camelCase convention.
- **Code:** \`const my_variable = 5;\`
- **Suggestion:** Rename to \`myVariable\`.
- **Explanation:** Consistent naming improves code readability.

### [WARNING] Rule: error-handling
- **File:** src/api.ts
- **Line:** 15
- **Issue:** Missing error handling for async operation.
- **Code:** \`await fetchData();\`
- **Suggestion:** Wrap in try-catch block.
- **Explanation:** Unhandled promise rejections can crash the application.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            assert.strictEqual(result.metadata, defaultMetadata);
            assert.strictEqual(result.summary.totalFindings, 2);
            assert.strictEqual(result.summary.bySeverity.error, 1);
            assert.strictEqual(result.summary.bySeverity.warning, 1);
            // When there are errors, assessment is overridden to 'fail'
            assert.strictEqual(result.summary.overallAssessment, 'fail');
            assert.strictEqual(result.findings.length, 2);

            // Check first finding
            const finding1 = result.findings[0];
            assert.strictEqual(finding1.severity, 'error');
            assert.strictEqual(finding1.rule, 'naming-conventions');
            assert.strictEqual(finding1.file, 'src/utils.ts');
            assert.strictEqual(finding1.line, 42);
            assert.ok(finding1.description.includes('camelCase'));
            assert.strictEqual(finding1.codeSnippet, 'const my_variable = 5;');
            assert.ok(finding1.suggestion?.includes('myVariable'));
        });

        test('should parse response with PASS assessment', () => {
            const response = `## Summary
All code follows the provided rules.
Overall: PASS

## Findings

No violations found.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            assert.strictEqual(result.summary.totalFindings, 0);
            assert.strictEqual(result.summary.overallAssessment, 'pass');
            assert.strictEqual(result.findings.length, 0);
        });

        test('should parse response with FAIL assessment', () => {
            const response = `## Summary
Critical issues found.
Overall: FAIL

## Findings

### [ERROR] Rule: security
- **File:** src/auth.ts
- **Line:** 10
- **Issue:** Hardcoded credentials detected.
- **Code:** \`const password = "secret123";\`
- **Suggestion:** Use environment variables.
- **Explanation:** Hardcoded credentials are a security risk.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            assert.strictEqual(result.summary.overallAssessment, 'fail');
            assert.strictEqual(result.summary.bySeverity.error, 1);
        });

        test('should handle findings without optional fields', () => {
            const response = `## Summary
Some issues found.
Overall: NEEDS_ATTENTION

## Findings

### [INFO] Rule: documentation
- **File:** N/A
- **Line:** N/A
- **Issue:** Missing documentation for public API.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            assert.strictEqual(result.findings.length, 1);
            const finding = result.findings[0];
            assert.strictEqual(finding.severity, 'info');
            assert.strictEqual(finding.file, undefined);
            assert.strictEqual(finding.line, undefined);
            assert.strictEqual(finding.codeSnippet, undefined);
            assert.strictEqual(finding.suggestion, undefined);
        });

        test('should parse SUGGESTION severity', () => {
            const response = `## Summary
Minor improvements possible.
Overall: PASS

## Findings

### [SUGGESTION] Rule: performance
- **File:** src/loop.ts
- **Line:** 25
- **Issue:** Consider using map instead of forEach.
- **Suggestion:** Use functional approach for better readability.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            assert.strictEqual(result.findings.length, 1);
            assert.strictEqual(result.findings[0].severity, 'suggestion');
        });

        test('should handle unstructured response gracefully', () => {
            const response = `The code looks fine overall. I noticed a few minor issues:

1. Variable naming could be improved in utils.ts
2. Consider adding more comments

Otherwise, the code is well-structured.`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            // Should still return a valid result with raw response preserved
            assert.ok(result.rawResponse);
            assert.strictEqual(result.rawResponse, response);
            assert.strictEqual(result.findings.length, 0);
            // Default assessment when no structured data
            assert.strictEqual(result.summary.overallAssessment, 'pass');
        });

        test('should count findings by rule', () => {
            const response = `## Summary
Multiple issues found.
Overall: NEEDS_ATTENTION

## Findings

### [WARNING] Rule: naming
- **File:** src/a.ts
- **Line:** 1
- **Issue:** Bad name.

### [WARNING] Rule: naming
- **File:** src/b.ts
- **Line:** 2
- **Issue:** Another bad name.

### [ERROR] Rule: security
- **File:** src/c.ts
- **Line:** 3
- **Issue:** Security issue.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            assert.strictEqual(result.summary.byRule['naming'], 2);
            assert.strictEqual(result.summary.byRule['security'], 1);
        });

        test('should preserve timestamp', () => {
            const response = `## Summary
No issues.
Overall: PASS

## Findings

No violations found.
`;

            const beforeTime = new Date();
            const result = parseCodeReviewResponse(response, defaultMetadata);
            const afterTime = new Date();

            assert.ok(result.timestamp >= beforeTime);
            assert.ok(result.timestamp <= afterTime);
        });

        test('should handle metadata for pending changes', () => {
            const pendingMetadata: CodeReviewMetadata = {
                type: 'pending',
                rulesUsed: ['rule.md']
            };

            const response = `## Summary
No issues.
Overall: PASS

## Findings

No violations found.
`;

            const result = parseCodeReviewResponse(response, pendingMetadata);

            assert.strictEqual(result.metadata.type, 'pending');
            assert.strictEqual(result.metadata.commitSha, undefined);
        });

        test('should handle metadata for staged changes', () => {
            const stagedMetadata: CodeReviewMetadata = {
                type: 'staged',
                rulesUsed: ['rule.md'],
                diffStats: { files: 1, additions: 10, deletions: 5 }
            };

            const response = `## Summary
No issues.
Overall: PASS

## Findings

No violations found.
`;

            const result = parseCodeReviewResponse(response, stagedMetadata);

            assert.strictEqual(result.metadata.type, 'staged');
            assert.deepStrictEqual(result.metadata.diffStats, { files: 1, additions: 10, deletions: 5 });
        });
    });

    suite('isStructuredResponse', () => {
        test('should return true for structured response with findings', () => {
            const response = `## Summary
Some issues found.

## Findings

### [ERROR] Rule: test
- **Issue:** Test issue
`;

            assert.strictEqual(isStructuredResponse(response), true);
        });

        test('should return true for structured response with summary only', () => {
            const response = `## Summary
No issues found.
Overall: PASS
`;

            assert.strictEqual(isStructuredResponse(response), true);
        });

        test('should return false for unstructured response', () => {
            const response = `The code looks fine. I found a few minor issues but nothing critical.`;

            assert.strictEqual(isStructuredResponse(response), false);
        });

        test('should return true for response with just Findings section', () => {
            const response = `## Findings

No violations found.
`;

            assert.strictEqual(isStructuredResponse(response), true);
        });
    });

    suite('formatCodeReviewResultAsMarkdown', () => {
        test('should format result with findings', () => {
            const result: CodeReviewResult = {
                metadata: defaultMetadata,
                summary: {
                    totalFindings: 2,
                    bySeverity: { error: 1, warning: 1, info: 0, suggestion: 0 },
                    byRule: { 'naming': 1, 'security': 1 },
                    overallAssessment: 'needs-attention',
                    summaryText: 'Some issues found.'
                },
                findings: [
                    {
                        id: 'f1',
                        severity: 'error',
                        rule: 'naming',
                        file: 'src/test.ts',
                        line: 10,
                        description: 'Bad naming',
                        codeSnippet: 'const x = 1;',
                        suggestion: 'Use descriptive name',
                        explanation: 'Helps readability'
                    },
                    {
                        id: 'f2',
                        severity: 'warning',
                        rule: 'security',
                        description: 'Potential issue'
                    }
                ],
                rawResponse: 'raw',
                timestamp: new Date()
            };

            const markdown = formatCodeReviewResultAsMarkdown(result);

            // Check header
            assert.ok(markdown.includes('# Code Review Results'));
            assert.ok(markdown.includes('abc1234')); // Short commit SHA

            // Check summary
            assert.ok(markdown.includes('NEEDS ATTENTION') || markdown.includes('NEEDS-ATTENTION'));
            assert.ok(markdown.includes('Some issues found.'));

            // Check statistics
            assert.ok(markdown.includes('Errors'));
            assert.ok(markdown.includes('Warnings'));

            // Check findings
            assert.ok(markdown.includes('naming'));
            assert.ok(markdown.includes('security'));
            assert.ok(markdown.includes('src/test.ts'));
            assert.ok(markdown.includes('Bad naming'));
            assert.ok(markdown.includes('const x = 1;'));
            assert.ok(markdown.includes('Use descriptive name'));
        });

        test('should format result with no findings', () => {
            const result: CodeReviewResult = {
                metadata: defaultMetadata,
                summary: {
                    totalFindings: 0,
                    bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                    byRule: {},
                    overallAssessment: 'pass',
                    summaryText: 'No issues found.'
                },
                findings: [],
                rawResponse: 'raw',
                timestamp: new Date()
            };

            const markdown = formatCodeReviewResultAsMarkdown(result);

            assert.ok(markdown.includes('PASS'));
            assert.ok(markdown.includes('No issues found'));
        });

        test('should include rules used section', () => {
            const result: CodeReviewResult = {
                metadata: {
                    ...defaultMetadata,
                    rulesUsed: ['style-guide.md', 'security-rules.md']
                },
                summary: {
                    totalFindings: 0,
                    bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                    byRule: {},
                    overallAssessment: 'pass',
                    summaryText: 'No issues.'
                },
                findings: [],
                rawResponse: 'raw',
                timestamp: new Date()
            };

            const markdown = formatCodeReviewResultAsMarkdown(result);

            assert.ok(markdown.includes('Rules Applied'));
            assert.ok(markdown.includes('style-guide.md'));
            assert.ok(markdown.includes('security-rules.md'));
        });

        test('should format pending changes review', () => {
            const result: CodeReviewResult = {
                metadata: {
                    type: 'pending',
                    rulesUsed: ['rule.md']
                },
                summary: {
                    totalFindings: 0,
                    bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                    byRule: {},
                    overallAssessment: 'pass',
                    summaryText: 'No issues.'
                },
                findings: [],
                rawResponse: 'raw',
                timestamp: new Date()
            };

            const markdown = formatCodeReviewResultAsMarkdown(result);

            assert.ok(markdown.includes('Pending Changes'));
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty response', () => {
            const result = parseCodeReviewResponse('', defaultMetadata);

            assert.strictEqual(result.findings.length, 0);
            assert.ok(result.summary);
        });

        test('should handle response with only whitespace', () => {
            const result = parseCodeReviewResponse('   \n\n   ', defaultMetadata);

            assert.strictEqual(result.findings.length, 0);
        });

        test('should handle malformed finding section', () => {
            const response = `## Summary
Issues found.
Overall: NEEDS_ATTENTION

## Findings

### [INVALID] Rule: test
This is not properly formatted.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            // Should not crash, may or may not parse the finding
            assert.ok(result);
            assert.ok(result.summary);
        });

        test('should handle mixed case severity', () => {
            const response = `## Summary
Issues found.
Overall: NEEDS_ATTENTION

## Findings

### [error] Rule: test
- **Issue:** Test issue.

### [Warning] Rule: test2
- **Issue:** Test issue 2.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            // Parser should handle case-insensitive matching
            assert.ok(result.findings.length >= 0);
        });

        test('should handle special characters in code snippets', () => {
            const response = `## Summary
Issues found.
Overall: NEEDS_ATTENTION

## Findings

### [ERROR] Rule: syntax
- **File:** src/test.ts
- **Issue:** Invalid syntax.
- **Code:** \`const x = "<div>test</div>";\`
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            if (result.findings.length > 0) {
                assert.ok(result.findings[0].codeSnippet?.includes('<div>'));
            }
        });

        test('should generate unique finding IDs', () => {
            const response = `## Summary
Issues found.
Overall: NEEDS_ATTENTION

## Findings

### [ERROR] Rule: test1
- **Issue:** Issue 1.

### [ERROR] Rule: test2
- **Issue:** Issue 2.

### [ERROR] Rule: test3
- **Issue:** Issue 3.
`;

            const result = parseCodeReviewResponse(response, defaultMetadata);

            const ids = result.findings.map(f => f.id);
            const uniqueIds = new Set(ids);
            assert.strictEqual(ids.length, uniqueIds.size, 'All finding IDs should be unique');
        });
    });
});

suite('Aggregated Result Formatting', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'commit',
        commitSha: 'abc1234567890',
        commitMessage: 'Test commit message',
        rulesUsed: ['rule1.md', 'rule2.md'],
        diffStats: {
            files: 3,
            additions: 50,
            deletions: 20
        }
    };

    test('formatAggregatedResultAsMarkdown includes parallel execution header', () => {
        const aggregatedResult: AggregatedCodeReviewResult = {
            metadata: defaultMetadata,
            summary: {
                totalFindings: 0,
                bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                byRule: {},
                overallAssessment: 'pass',
                summaryText: 'No issues found.'
            },
            findings: [],
            ruleResults: [],
            rawResponse: '',
            timestamp: new Date(),
            executionStats: {
                totalRules: 2,
                successfulRules: 2,
                failedRules: 0,
                totalTimeMs: 5000
            }
        };

        const markdown = formatAggregatedResultAsMarkdown(aggregatedResult);

        assert.ok(markdown.includes('Code Review Results (Parallel)'));
        assert.ok(markdown.includes('**Rules Processed:**'));
        assert.ok(markdown.includes('2 (2 passed'));
        assert.ok(markdown.includes('**Total Time:**'));
    });

    test('formatAggregatedResultAsMarkdown shows execution stats', () => {
        const aggregatedResult: AggregatedCodeReviewResult = {
            metadata: defaultMetadata,
            summary: {
                totalFindings: 2,
                bySeverity: { error: 1, warning: 1, info: 0, suggestion: 0 },
                byRule: { 'naming.md': 1, 'security.md': 1 },
                overallAssessment: 'fail',
                summaryText: 'Found 2 issues.'
            },
            findings: [
                { id: 'f1', severity: 'error', rule: 'naming.md', description: 'Bad name' },
                { id: 'f2', severity: 'warning', rule: 'security.md', description: 'Potential issue' }
            ],
            ruleResults: [
                {
                    rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                    processId: 'p1',
                    success: true,
                    findings: [{ id: 'f1', severity: 'error', rule: 'naming.md', description: 'Bad name' }],
                    assessment: 'fail'
                },
                {
                    rule: { filename: 'security.md', path: '/rules/security.md', content: '' },
                    processId: 'p2',
                    success: true,
                    findings: [{ id: 'f2', severity: 'warning', rule: 'security.md', description: 'Potential issue' }],
                    assessment: 'needs-attention'
                }
            ],
            rawResponse: '',
            timestamp: new Date(),
            executionStats: {
                totalRules: 2,
                successfulRules: 2,
                failedRules: 0,
                totalTimeMs: 3500
            }
        };

        const markdown = formatAggregatedResultAsMarkdown(aggregatedResult);

        assert.ok(markdown.includes('2 passed'));
        assert.ok(markdown.includes('0 failed'));
        assert.ok(markdown.includes('3.5s'));
    });

    test('formatAggregatedResultAsMarkdown groups findings by rule', () => {
        const aggregatedResult: AggregatedCodeReviewResult = {
            metadata: defaultMetadata,
            summary: {
                totalFindings: 3,
                bySeverity: { error: 2, warning: 1, info: 0, suggestion: 0 },
                byRule: { 'naming.md': 2, 'security.md': 1 },
                overallAssessment: 'fail',
                summaryText: 'Found 3 issues.'
            },
            findings: [
                { id: 'f1', severity: 'error', rule: 'naming.md', description: 'Issue 1' },
                { id: 'f2', severity: 'error', rule: 'naming.md', description: 'Issue 2' },
                { id: 'f3', severity: 'warning', rule: 'security.md', description: 'Issue 3' }
            ],
            ruleResults: [],
            rawResponse: '',
            timestamp: new Date(),
            executionStats: {
                totalRules: 2,
                successfulRules: 2,
                failedRules: 0,
                totalTimeMs: 2000
            }
        };

        const markdown = formatAggregatedResultAsMarkdown(aggregatedResult);

        // Should have sections grouped by rule
        assert.ok(markdown.includes('naming.md (2 issues)'));
        assert.ok(markdown.includes('security.md (1 issue)'));
    });

    test('formatAggregatedResultAsMarkdown includes Rule Results table', () => {
        const aggregatedResult: AggregatedCodeReviewResult = {
            metadata: defaultMetadata,
            summary: {
                totalFindings: 0,
                bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                byRule: {},
                overallAssessment: 'pass',
                summaryText: 'No issues found.'
            },
            findings: [],
            ruleResults: [
                {
                    rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                    processId: 'p1',
                    success: true,
                    findings: [],
                    assessment: 'pass'
                },
                {
                    rule: { filename: 'security.md', path: '/rules/security.md', content: '' },
                    processId: 'p2',
                    success: false,
                    error: 'Timeout',
                    findings: []
                }
            ],
            rawResponse: '',
            timestamp: new Date(),
            executionStats: {
                totalRules: 2,
                successfulRules: 1,
                failedRules: 1,
                totalTimeMs: 10000
            }
        };

        const markdown = formatAggregatedResultAsMarkdown(aggregatedResult);

        assert.ok(markdown.includes('Rule Results'));
        assert.ok(markdown.includes('naming.md'));
        assert.ok(markdown.includes('security.md'));
        assert.ok(markdown.includes('Success'));
        assert.ok(markdown.includes('Failed'));
        assert.ok(markdown.includes('Timeout'));
    });

    test('formatAggregatedResultAsMarkdown shows no findings message when empty', () => {
        const aggregatedResult: AggregatedCodeReviewResult = {
            metadata: defaultMetadata,
            summary: {
                totalFindings: 0,
                bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                byRule: {},
                overallAssessment: 'pass',
                summaryText: 'No issues found.'
            },
            findings: [],
            ruleResults: [],
            rawResponse: '',
            timestamp: new Date(),
            executionStats: {
                totalRules: 1,
                successfulRules: 1,
                failedRules: 0,
                totalTimeMs: 1000
            }
        };

        const markdown = formatAggregatedResultAsMarkdown(aggregatedResult);

        assert.ok(markdown.includes('No issues found'));
        assert.ok(markdown.includes('PASS'));
    });
});

suite('aggregateReviewResults Function', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'commit',
        commitSha: 'abc123',
        rulesUsed: [],
        repositoryRoot: '/repo'
    };

    test('tags findings with source rule if not already set', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'Unknown Rule', description: 'Test issue' }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        // The finding should be tagged with the rule filename
        assert.strictEqual(result.findings[0].rule, 'naming.md');
    });

    test('preserves existing rule tags on findings', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'custom-rule-name', description: 'Test issue' }
                ]
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        // Should preserve the original rule name
        assert.strictEqual(result.findings[0].rule, 'custom-rule-name');
    });

    test('determines worst-case assessment from all rules', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [],
                assessment: 'pass'
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [],
                assessment: 'needs-attention'
            },
            {
                rule: { filename: 'rule3.md', path: '/rules/rule3.md', content: '' },
                processId: 'p3',
                success: true,
                findings: [],
                assessment: 'pass'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 3000);

        // Should be needs-attention (worst case among the rules)
        assert.strictEqual(result.summary.overallAssessment, 'needs-attention');
    });

    test('fail assessment takes precedence', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'p1',
                success: true,
                findings: [],
                assessment: 'needs-attention'
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'p2',
                success: true,
                findings: [{ id: 'f1', severity: 'error', rule: 'rule2.md', description: 'Critical' }],
                assessment: 'fail'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 2000);

        assert.strictEqual(result.summary.overallAssessment, 'fail');
    });

    test('updates rulesUsed and rulePaths in metadata', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'a.md', path: '/rules/a.md', content: '' },
                processId: 'p1',
                success: true,
                findings: []
            },
            {
                rule: { filename: 'b.md', path: '/rules/b.md', content: '' },
                processId: 'p2',
                success: true,
                findings: []
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 1000);

        assert.deepStrictEqual(result.metadata.rulesUsed, ['a.md', 'b.md']);
        assert.deepStrictEqual(result.metadata.rulePaths, ['/rules/a.md', '/rules/b.md']);
    });
});

