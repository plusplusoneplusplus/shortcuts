/**
 * Code Review Response Parser
 * 
 * Parses AI responses into structured code review results.
 * Uses the map-reduce framework for reduce operations.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AggregatedCodeReviewResult,
    CodeReviewMetadata,
    CodeReviewReduceMode,
    CodeReviewResult,
    ReduceStats,
    RESPONSE_PATTERNS,
    ReviewFinding,
    ReviewSeverity,
    ReviewSummary,
    SingleRuleReviewResult
} from './types';

/**
 * Generate a unique ID for a finding
 */
function generateFindingId(): string {
    return `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse severity from string
 */
function parseSeverity(severityStr: string): ReviewSeverity {
    const normalized = severityStr.toLowerCase().trim();
    switch (normalized) {
        case 'error':
            return 'error';
        case 'warning':
            return 'warning';
        case 'info':
            return 'info';
        case 'suggestion':
            return 'suggestion';
        default:
            return 'info';
    }
}

/**
 * Parse overall assessment from string
 */
function parseOverallAssessment(text: string): 'pass' | 'needs-attention' | 'fail' {
    const match = text.match(RESPONSE_PATTERNS.overallAssessment);
    if (match) {
        const assessment = match[1].toLowerCase().replace('_', '-');
        if (assessment === 'pass') {
            return 'pass';
        }
        if (assessment === 'fail') {
            return 'fail';
        }
        return 'needs-attention';
    }
    return 'needs-attention';
}

/**
 * Extract text content, trimming whitespace
 */
function extractText(text: string | undefined): string {
    return text?.trim() || '';
}

/**
 * Parse a single finding from matched text
 */
function parseFinding(severity: string, rule: string, content: string): ReviewFinding {
    const finding: ReviewFinding = {
        id: generateFindingId(),
        severity: parseSeverity(severity),
        rule: rule.trim(),
        description: ''
    };

    // Extract file
    const fileMatch = content.match(RESPONSE_PATTERNS.findingFile);
    if (fileMatch && fileMatch[1].trim() !== 'N/A') {
        finding.file = extractText(fileMatch[1]);
    }

    // Extract line
    const lineMatch = content.match(RESPONSE_PATTERNS.findingLine);
    if (lineMatch && lineMatch[1] !== 'N/A') {
        finding.line = parseInt(lineMatch[1], 10);
    }

    // Extract issue description
    const issueMatch = content.match(RESPONSE_PATTERNS.findingIssue);
    if (issueMatch) {
        finding.description = extractText(issueMatch[1]);
    }

    // Extract code snippet
    const codeMatch = content.match(RESPONSE_PATTERNS.findingCode);
    if (codeMatch) {
        finding.codeSnippet = codeMatch[1];
    }

    // Extract suggestion
    const suggestionMatch = content.match(RESPONSE_PATTERNS.findingSuggestion);
    if (suggestionMatch) {
        finding.suggestion = extractText(suggestionMatch[1]);
    }

    // Extract explanation
    const explanationMatch = content.match(RESPONSE_PATTERNS.findingExplanation);
    if (explanationMatch) {
        finding.explanation = extractText(explanationMatch[1]);
    }

    return finding;
}

/**
 * Parse all findings from the findings section
 */
function parseFindings(findingsText: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];

    // Check for "no violations" message
    if (/no\s*(violations?|issues?)\s*found/i.test(findingsText)) {
        return findings;
    }

    // Reset regex lastIndex
    RESPONSE_PATTERNS.finding.lastIndex = 0;

    let match;
    while ((match = RESPONSE_PATTERNS.finding.exec(findingsText)) !== null) {
        const [, severity, rule, content] = match;
        const finding = parseFinding(severity, rule, content);
        findings.push(finding);
    }

    return findings;
}

/**
 * Extract summary text from summary section
 */
function extractSummaryText(summarySection: string): string {
    // Remove the "Overall:" line and get the rest
    const lines = summarySection.split('\n');
    const textLines = lines.filter(line => 
        !line.match(RESPONSE_PATTERNS.overallAssessment) && 
        line.trim().length > 0
    );
    return textLines.join(' ').trim();
}

/**
 * Create a summary from findings
 */
function createSummary(findings: ReviewFinding[], rawResponse: string): ReviewSummary {
    const bySeverity = {
        error: 0,
        warning: 0,
        info: 0,
        suggestion: 0
    };

    const byRule: Record<string, number> = {};

    for (const finding of findings) {
        bySeverity[finding.severity]++;
        byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
    }

    // Determine overall assessment
    let overallAssessment: 'pass' | 'needs-attention' | 'fail' = 'pass';
    
    // First try to parse from response
    const parsedAssessment = parseOverallAssessment(rawResponse);
    if (parsedAssessment !== 'needs-attention' || findings.length > 0) {
        overallAssessment = parsedAssessment;
    }

    // Override based on findings if not explicitly set
    if (bySeverity.error > 0) {
        overallAssessment = 'fail';
    } else if (bySeverity.warning > 0) {
        overallAssessment = 'needs-attention';
    } else if (findings.length === 0) {
        overallAssessment = 'pass';
    }

    // Extract summary text
    const summaryMatch = rawResponse.match(RESPONSE_PATTERNS.summarySection);
    let summaryText = '';
    if (summaryMatch) {
        summaryText = extractSummaryText(summaryMatch[1]);
    }

    if (!summaryText) {
        // Generate default summary
        if (findings.length === 0) {
            summaryText = 'No issues found. The code follows the provided rules.';
        } else {
            summaryText = `Found ${findings.length} issue(s): ${bySeverity.error} error(s), ${bySeverity.warning} warning(s), ${bySeverity.info} info, ${bySeverity.suggestion} suggestion(s).`;
        }
    }

    return {
        totalFindings: findings.length,
        bySeverity,
        byRule,
        overallAssessment,
        summaryText
    };
}

/**
 * Parse an AI response into a structured code review result
 * @param rawResponse The raw AI response text
 * @param metadata The code review metadata
 * @returns Structured code review result
 */
export function parseCodeReviewResponse(
    rawResponse: string,
    metadata: CodeReviewMetadata
): CodeReviewResult {
    // Try to extract findings section
    const findingsMatch = rawResponse.match(RESPONSE_PATTERNS.findingsSection);
    const findingsText = findingsMatch ? findingsMatch[1] : rawResponse;

    // Parse findings
    const findings = parseFindings(findingsText);

    // Create summary
    const summary = createSummary(findings, rawResponse);

    return {
        metadata,
        summary,
        findings,
        rawResponse,
        timestamp: new Date()
    };
}

/**
 * Check if a response appears to be in structured format
 * @param response The response to check
 * @returns True if the response appears structured
 */
export function isStructuredResponse(response: string): boolean {
    // Check for key markers of structured response
    const hasFindings = RESPONSE_PATTERNS.findingsSection.test(response);
    const hasSummary = RESPONSE_PATTERNS.summarySection.test(response);
    
    return hasFindings || hasSummary;
}

/**
 * Options for aggregating review results
 */
export interface AggregateOptions {
    /** Mode for the reduce phase: 'deterministic' (default) or 'ai' */
    reduceMode?: CodeReviewReduceMode;
    /** Function to invoke AI for AI-powered reduce (required if reduceMode is 'ai') */
    invokeAI?: (prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>;
}

/**
 * Aggregate multiple single-rule review results into a combined result.
 * This is a legacy function kept for backward compatibility.
 * New code should use the map-reduce framework directly.
 * 
 * @param ruleResults Array of results from individual rule reviews
 * @param metadata The original review metadata
 * @param totalTimeMs Total execution time for all parallel reviews
 * @param options Optional configuration for the reduce phase
 * @returns Aggregated code review result
 */
export function aggregateReviewResults(
    ruleResults: SingleRuleReviewResult[],
    metadata: CodeReviewMetadata,
    totalTimeMs: number,
    options?: AggregateOptions
): AggregatedCodeReviewResult {
    // Collect raw responses
    const rawResponses: string[] = [];
    for (const result of ruleResults) {
        if (result.rawResponse) {
            rawResponses.push(`--- Rule: ${result.rule.filename} ---\n${result.rawResponse}`);
        }
    }
    
    // Collect and tag all findings
    const allFindings: ReviewFinding[] = [];
    for (const result of ruleResults) {
        if (result.success && result.findings) {
            for (const finding of result.findings) {
                finding.ruleFile = result.rule.filename;
                if (!finding.rule || finding.rule === 'Unknown Rule') {
                    finding.rule = result.rule.filename;
                }
                allFindings.push(finding);
            }
        }
    }
    
    // Apply deduplication using deterministic logic
    const findings = deduplicateFindingsSync(allFindings);
    const summary = createAggregatedSummary(findings, ruleResults);
    const reduceStats: ReduceStats = {
        originalCount: allFindings.length,
        dedupedCount: findings.length,
        mergedCount: allFindings.length - findings.length,
        reduceTimeMs: 0,
        usedAIReduce: false
    };

    // Execution statistics
    const successfulRules = ruleResults.filter(r => r.success).length;
    const failedRules = ruleResults.filter(r => !r.success).length;

    return {
        metadata: {
            ...metadata,
            rulesUsed: ruleResults.map(r => r.rule.filename),
            rulePaths: ruleResults.map(r => r.rule.path)
        },
        summary,
        findings,
        ruleResults,
        rawResponse: rawResponses.join('\n\n'),
        timestamp: new Date(),
        executionStats: {
            totalRules: ruleResults.length,
            successfulRules,
            failedRules,
            totalTimeMs
        },
        reduceStats
    };
}

/**
 * Aggregate multiple single-rule review results into a combined result (async version).
 * This is a legacy function kept for backward compatibility.
 * New code should use the map-reduce framework directly.
 * 
 * @param ruleResults Array of results from individual rule reviews
 * @param metadata The original review metadata
 * @param totalTimeMs Total execution time for all parallel reviews
 * @param options Configuration for the reduce phase
 * @returns Promise resolving to aggregated code review result
 */
export async function aggregateReviewResultsAsync(
    ruleResults: SingleRuleReviewResult[],
    metadata: CodeReviewMetadata,
    totalTimeMs: number,
    options?: AggregateOptions
): Promise<AggregatedCodeReviewResult> {
    // For backward compatibility, delegate to sync version
    // The main code path now uses the map-reduce framework directly
    return aggregateReviewResults(ruleResults, metadata, totalTimeMs, options);
}

/**
 * Synchronous deduplication of findings for backwards compatibility
 */
function deduplicateFindingsSync(findings: ReviewFinding[]): ReviewFinding[] {
    const seen = new Map<string, ReviewFinding>();
    
    for (const finding of findings) {
        const key = getFindingKeySync(finding);
        
        if (seen.has(key)) {
            const existing = seen.get(key)!;
            const merged = mergeFindingSync(existing, finding);
            seen.set(key, merged);
        } else {
            seen.set(key, finding);
        }
    }
    
    // Sort by severity
    const result = Array.from(seen.values());
    const severityOrder: Record<ReviewSeverity, number> = {
        'error': 0,
        'warning': 1,
        'info': 2,
        'suggestion': 3
    };
    
    return result.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) {
            return severityDiff;
        }
        const fileA = a.file || '';
        const fileB = b.file || '';
        const fileDiff = fileA.localeCompare(fileB);
        if (fileDiff !== 0) {
            return fileDiff;
        }
        return (a.line || 0) - (b.line || 0);
    });
}

function getFindingKeySync(finding: ReviewFinding): string {
    const file = finding.file || 'global';
    const line = finding.line || 0;
    const descNormalized = (finding.description || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    return `${file}:${line}:${descNormalized}`;
}

function mergeFindingSync(existing: ReviewFinding, newFinding: ReviewFinding): ReviewFinding {
    const severityRank: Record<ReviewSeverity, number> = {
        'error': 4,
        'warning': 3,
        'info': 2,
        'suggestion': 1
    };
    
    const keepNew = severityRank[newFinding.severity] > severityRank[existing.severity];
    const base = keepNew ? newFinding : existing;
    const other = keepNew ? existing : newFinding;
    
    return {
        ...base,
        rule: base.rule === other.rule ? base.rule : `${base.rule}, ${other.rule}`,
        suggestion: (base.suggestion?.length || 0) >= (other.suggestion?.length || 0)
            ? base.suggestion
            : other.suggestion,
        explanation: (base.explanation?.length || 0) >= (other.explanation?.length || 0)
            ? base.explanation
            : other.explanation
    };
}

/**
 * Create an aggregated summary from all findings and rule results
 */
function createAggregatedSummary(findings: ReviewFinding[], ruleResults: SingleRuleReviewResult[]): ReviewSummary {
    const bySeverity = {
        error: 0,
        warning: 0,
        info: 0,
        suggestion: 0
    };

    const byRule: Record<string, number> = {};

    for (const finding of findings) {
        bySeverity[finding.severity]++;
        byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
    }

    // Determine overall assessment based on worst-case from all rules
    let overallAssessment: 'pass' | 'needs-attention' | 'fail' = 'pass';

    // First check aggregated severity counts
    if (bySeverity.error > 0) {
        overallAssessment = 'fail';
    } else if (bySeverity.warning > 0) {
        overallAssessment = 'needs-attention';
    }

    // Also check individual rule assessments
    for (const result of ruleResults) {
        if (result.assessment === 'fail') {
            overallAssessment = 'fail';
            break;
        } else if (result.assessment === 'needs-attention' && overallAssessment !== 'fail') {
            overallAssessment = 'needs-attention';
        }
    }

    // Count failed rules
    const failedRuleCount = ruleResults.filter(r => !r.success).length;

    // Generate summary text
    let summaryText: string;
    if (failedRuleCount > 0) {
        summaryText = `Reviewed against ${ruleResults.length} rules (${failedRuleCount} failed). `;
    } else {
        summaryText = `Reviewed against ${ruleResults.length} rules. `;
    }

    if (findings.length === 0) {
        summaryText += 'No issues found. The code follows all provided rules.';
    } else {
        summaryText += `Found ${findings.length} issue(s): ${bySeverity.error} error(s), ${bySeverity.warning} warning(s), ${bySeverity.info} info, ${bySeverity.suggestion} suggestion(s).`;
    }

    return {
        totalFindings: findings.length,
        bySeverity,
        byRule,
        overallAssessment,
        summaryText
    };
}

/**
 * Format a code review result as markdown for display
 * @param result The code review result
 * @returns Formatted markdown string
 */
export function formatCodeReviewResultAsMarkdown(result: CodeReviewResult): string {
    const lines: string[] = [];

    // Header
    lines.push('# Code Review Results');
    lines.push('');

    // Metadata
    if (result.metadata.type === 'commit' && result.metadata.commitSha) {
        lines.push(`**Commit:** \`${result.metadata.commitSha.substring(0, 7)}\``);
        if (result.metadata.commitMessage) {
            lines.push(`**Message:** ${result.metadata.commitMessage}`);
        }
    } else if (result.metadata.type === 'pending') {
        lines.push('**Type:** Pending Changes');
    } else {
        lines.push('**Type:** Staged Changes');
    }

    if (result.metadata.diffStats) {
        const { files, additions, deletions } = result.metadata.diffStats;
        lines.push(`**Changes:** ${files} file(s), +${additions}/-${deletions} lines`);
    }

    lines.push(`**Rules Used:** ${result.metadata.rulesUsed.join(', ')}`);
    lines.push(`**Reviewed:** ${result.timestamp.toLocaleString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    
    const assessmentEmoji = result.summary.overallAssessment === 'pass' ? '✅' :
        result.summary.overallAssessment === 'fail' ? '❌' : '⚠️';
    lines.push(`${assessmentEmoji} **${result.summary.overallAssessment.toUpperCase()}**`);
    lines.push('');
    lines.push(result.summary.summaryText);
    lines.push('');

    // Statistics
    if (result.summary.totalFindings > 0) {
        lines.push('### Statistics');
        lines.push('');
        lines.push(`| Severity | Count |`);
        lines.push(`|----------|-------|`);
        lines.push(`| 🔴 Errors | ${result.summary.bySeverity.error} |`);
        lines.push(`| 🟠 Warnings | ${result.summary.bySeverity.warning} |`);
        lines.push(`| 🔵 Info | ${result.summary.bySeverity.info} |`);
        lines.push(`| 💡 Suggestions | ${result.summary.bySeverity.suggestion} |`);
        lines.push('');
    }

    // Findings
    lines.push('## Findings');
    lines.push('');

    if (result.findings.length === 0) {
        lines.push('✨ No issues found! The code follows the provided rules.');
    } else {
        for (const finding of result.findings) {
            const severityEmoji = finding.severity === 'error' ? '🔴' :
                finding.severity === 'warning' ? '🟠' :
                finding.severity === 'info' ? '🔵' : '💡';

            lines.push(`### ${severityEmoji} ${finding.rule}`);
            lines.push('');

            if (finding.file) {
                const lineInfo = finding.line ? `:${finding.line}` : '';
                lines.push(`📁 **File:** \`${finding.file}${lineInfo}\``);
            }

            lines.push('');
            lines.push(`**Issue:** ${finding.description}`);
            lines.push('');

            if (finding.codeSnippet) {
                lines.push('**Code:**');
                lines.push('```');
                lines.push(finding.codeSnippet);
                lines.push('```');
                lines.push('');
            }

            if (finding.suggestion) {
                lines.push(`💡 **Suggestion:** ${finding.suggestion}`);
                lines.push('');
            }

            if (finding.explanation) {
                lines.push(`📖 **Explanation:** ${finding.explanation}`);
                lines.push('');
            }

            lines.push('---');
            lines.push('');
        }
    }

    // Rules Applied section
    if (result.metadata.rulesUsed && result.metadata.rulesUsed.length > 0) {
        lines.push('');
        lines.push('## Rules Applied');
        lines.push('');
        for (const rule of result.metadata.rulesUsed) {
            lines.push(`- 📄 ${rule}`);
        }
    }

    return lines.join('\n');
}

/**
 * Format an aggregated code review result as markdown for display
 * @param result The aggregated code review result
 * @returns Formatted markdown string
 */
export function formatAggregatedResultAsMarkdown(result: AggregatedCodeReviewResult): string {
    const lines: string[] = [];

    // Header
    lines.push('# Code Review Results (Parallel)');
    lines.push('');

    // Metadata
    if (result.metadata.type === 'commit' && result.metadata.commitSha) {
        lines.push(`**Commit:** \`${result.metadata.commitSha.substring(0, 7)}\``);
        if (result.metadata.commitMessage) {
            lines.push(`**Message:** ${result.metadata.commitMessage}`);
        }
    } else if (result.metadata.type === 'pending') {
        lines.push('**Type:** Pending Changes');
    } else {
        lines.push('**Type:** Staged Changes');
    }

    if (result.metadata.diffStats) {
        const { files, additions, deletions } = result.metadata.diffStats;
        lines.push(`**Changes:** ${files} file(s), +${additions}/-${deletions} lines`);
    }

    // Execution stats
    const { totalRules, successfulRules, failedRules, totalTimeMs } = result.executionStats;
    lines.push(`**Rules Processed:** ${totalRules} (${successfulRules} passed, ${failedRules} failed)`);
    lines.push(`**Total Time:** ${(totalTimeMs / 1000).toFixed(1)}s`);
    lines.push(`**Reviewed:** ${result.timestamp.toLocaleString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');

    const assessmentEmoji = result.summary.overallAssessment === 'pass' ? '✅' :
        result.summary.overallAssessment === 'fail' ? '❌' : '⚠️';
    lines.push(`${assessmentEmoji} **${result.summary.overallAssessment.toUpperCase()}**`);
    lines.push('');
    lines.push(result.summary.summaryText);
    lines.push('');

    // Statistics
    if (result.summary.totalFindings > 0) {
        lines.push('### Statistics');
        lines.push('');
        lines.push(`| Severity | Count |`);
        lines.push(`|----------|-------|`);
        lines.push(`| 🔴 Errors | ${result.summary.bySeverity.error} |`);
        lines.push(`| 🟠 Warnings | ${result.summary.bySeverity.warning} |`);
        lines.push(`| 🔵 Info | ${result.summary.bySeverity.info} |`);
        lines.push(`| 💡 Suggestions | ${result.summary.bySeverity.suggestion} |`);
        lines.push('');
    }

    // Findings grouped by rule
    lines.push('## Findings');
    lines.push('');

    if (result.findings.length === 0) {
        lines.push('✨ No issues found! The code follows all provided rules.');
    } else {
        // Group findings by rule
        const findingsByRule = new Map<string, ReviewFinding[]>();
        for (const finding of result.findings) {
            const ruleName = finding.rule;
            if (!findingsByRule.has(ruleName)) {
                findingsByRule.set(ruleName, []);
            }
            findingsByRule.get(ruleName)!.push(finding);
        }

        for (const [ruleName, findings] of findingsByRule) {
            lines.push(`### 📄 ${ruleName} (${findings.length} issue${findings.length > 1 ? 's' : ''})`);
            lines.push('');

            for (const finding of findings) {
                const severityEmoji = finding.severity === 'error' ? '🔴' :
                    finding.severity === 'warning' ? '🟠' :
                    finding.severity === 'info' ? '🔵' : '💡';

                lines.push(`#### ${severityEmoji} ${finding.severity.toUpperCase()}`);
                lines.push('');

                if (finding.file) {
                    const lineInfo = finding.line ? `:${finding.line}` : '';
                    lines.push(`📁 **File:** \`${finding.file}${lineInfo}\``);
                }

                lines.push('');
                lines.push(`**Issue:** ${finding.description}`);
                lines.push('');

                if (finding.codeSnippet) {
                    lines.push('**Code:**');
                    lines.push('```');
                    lines.push(finding.codeSnippet);
                    lines.push('```');
                    lines.push('');
                }

                if (finding.suggestion) {
                    lines.push(`💡 **Suggestion:** ${finding.suggestion}`);
                    lines.push('');
                }

                if (finding.explanation) {
                    lines.push(`📖 **Explanation:** ${finding.explanation}`);
                    lines.push('');
                }

                lines.push('---');
                lines.push('');
            }
        }
    }

    // Rule Results section (shows status of each rule)
    lines.push('');
    lines.push('## Rule Results');
    lines.push('');
    lines.push('| Rule | Status | Findings |');
    lines.push('|------|--------|----------|');
    for (const ruleResult of result.ruleResults) {
        const statusEmoji = ruleResult.success ? '✅' : '❌';
        const status = ruleResult.success ? 'Success' : `Failed: ${ruleResult.error || 'Unknown error'}`;
        const findingCount = ruleResult.findings.length;
        lines.push(`| ${ruleResult.rule.filename} | ${statusEmoji} ${status} | ${findingCount} |`);
    }

    return lines.join('\n');
}

