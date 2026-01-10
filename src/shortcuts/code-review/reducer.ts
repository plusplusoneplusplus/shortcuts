/**
 * Code Review Reducer
 * 
 * Provides an interface and implementations for the reduce phase of code review.
 * Two modes are supported:
 * - Deterministic: Fast, code-based deduplication and aggregation (default)
 * - AI: Uses an AI call to intelligently synthesize findings
 */

import {
    AI_REDUCE_PROMPT_TEMPLATE,
    AIReduceResponse,
    CodeReviewReduceMode,
    ReduceContext,
    ReduceResult,
    ReduceStats,
    ReviewFinding,
    ReviewSeverity,
    ReviewSummary,
    SingleRuleReviewResult
} from './types';

/**
 * Interface for reduce phase implementations
 */
export interface Reducer {
    /**
     * Reduce multiple rule review results into a single aggregated result
     * @param ruleResults Results from individual rule reviews
     * @param context Context for the reduce phase
     * @returns Aggregated and deduplicated result
     */
    reduce(ruleResults: SingleRuleReviewResult[], context: ReduceContext): Promise<ReduceResult>;
}

/**
 * Deterministic reducer that uses code-based logic for deduplication.
 * This is the default reducer - fast, consistent, and doesn't require additional API calls.
 */
export class DeterministicReducer implements Reducer {
    /**
     * Reduce findings using deterministic code-based logic
     */
    async reduce(ruleResults: SingleRuleReviewResult[], context: ReduceContext): Promise<ReduceResult> {
        const startTime = Date.now();
        
        // Collect all findings from successful rule results
        const allFindings: ReviewFinding[] = [];
        for (const result of ruleResults) {
            if (result.success && result.findings) {
                for (const finding of result.findings) {
                    // Tag each finding with the source rule file
                    const taggedFinding: ReviewFinding = {
                        ...finding,
                        ruleFile: result.rule.filename
                    };
                    // Ensure the rule field has a value
                    if (!taggedFinding.rule || taggedFinding.rule === 'Unknown Rule') {
                        taggedFinding.rule = result.rule.filename;
                    }
                    allFindings.push(taggedFinding);
                }
            }
        }
        
        const originalCount = allFindings.length;
        
        // Deduplicate findings
        const dedupedFindings = this.deduplicateFindings(allFindings);
        
        // Sort by severity (errors first, then warnings, etc.)
        const sortedFindings = this.sortBySeverity(dedupedFindings);
        
        // Create summary
        const summary = this.createSummary(sortedFindings, ruleResults);
        
        const reduceTimeMs = Date.now() - startTime;
        
        return {
            findings: sortedFindings,
            summary,
            reduceStats: {
                originalCount,
                dedupedCount: sortedFindings.length,
                mergedCount: originalCount - sortedFindings.length,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }
    
    /**
     * Deduplicate findings based on file, line, and description similarity
     */
    private deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
        const seen = new Map<string, ReviewFinding>();
        
        for (const finding of findings) {
            const key = this.getFindingKey(finding);
            
            if (seen.has(key)) {
                // Merge with existing finding - keep the one with higher severity
                const existing = seen.get(key)!;
                const merged = this.mergeFinding(existing, finding);
                seen.set(key, merged);
            } else {
                seen.set(key, finding);
            }
        }
        
        return Array.from(seen.values());
    }
    
    /**
     * Generate a key for deduplication based on file, line, and normalized description
     */
    private getFindingKey(finding: ReviewFinding): string {
        const file = finding.file || 'global';
        const line = finding.line || 0;
        // Normalize description for comparison (lowercase, remove extra whitespace)
        const descNormalized = (finding.description || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 100); // Compare first 100 chars
        
        return `${file}:${line}:${descNormalized}`;
    }
    
    /**
     * Merge two findings, keeping the more severe one and combining metadata
     */
    private mergeFinding(existing: ReviewFinding, newFinding: ReviewFinding): ReviewFinding {
        const severityRank: Record<ReviewSeverity, number> = {
            'error': 4,
            'warning': 3,
            'info': 2,
            'suggestion': 1
        };
        
        // Keep the one with higher severity
        const keepNew = severityRank[newFinding.severity] > severityRank[existing.severity];
        const base = keepNew ? newFinding : existing;
        const other = keepNew ? existing : newFinding;
        
        return {
            ...base,
            // Combine rule references if they're different
            rule: base.rule === other.rule ? base.rule : `${base.rule}, ${other.rule}`,
            // Keep the more detailed suggestion
            suggestion: (base.suggestion?.length || 0) >= (other.suggestion?.length || 0)
                ? base.suggestion
                : other.suggestion,
            // Keep the more detailed explanation
            explanation: (base.explanation?.length || 0) >= (other.explanation?.length || 0)
                ? base.explanation
                : other.explanation
        };
    }
    
    /**
     * Sort findings by severity (errors first)
     */
    private sortBySeverity(findings: ReviewFinding[]): ReviewFinding[] {
        const severityOrder: Record<ReviewSeverity, number> = {
            'error': 0,
            'warning': 1,
            'info': 2,
            'suggestion': 3
        };
        
        return [...findings].sort((a, b) => {
            // First by severity
            const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
            if (severityDiff !== 0) {
                return severityDiff;
            }
            
            // Then by file
            const fileA = a.file || '';
            const fileB = b.file || '';
            const fileDiff = fileA.localeCompare(fileB);
            if (fileDiff !== 0) {
                return fileDiff;
            }
            
            // Then by line
            return (a.line || 0) - (b.line || 0);
        });
    }
    
    /**
     * Create a summary from the findings
     */
    private createSummary(findings: ReviewFinding[], ruleResults: SingleRuleReviewResult[]): ReviewSummary {
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
        
        // Determine overall assessment based on worst-case
        let overallAssessment: 'pass' | 'needs-attention' | 'fail' = 'pass';
        
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
}

/**
 * AI-powered reducer that uses an additional AI call to synthesize findings.
 * Provides intelligent deduplication, conflict resolution, and prioritization.
 */
export class AIReducer implements Reducer {
    private fallbackReducer: DeterministicReducer;
    
    constructor(
        private invokeAI: (prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>
    ) {
        this.fallbackReducer = new DeterministicReducer();
    }
    
    /**
     * Reduce findings using AI-powered synthesis
     */
    async reduce(ruleResults: SingleRuleReviewResult[], context: ReduceContext): Promise<ReduceResult> {
        const startTime = Date.now();
        
        // Collect all findings
        const allFindings: ReviewFinding[] = [];
        for (const result of ruleResults) {
            if (result.success && result.findings) {
                for (const finding of result.findings) {
                    const taggedFinding: ReviewFinding = {
                        ...finding,
                        ruleFile: result.rule.filename
                    };
                    if (!taggedFinding.rule || taggedFinding.rule === 'Unknown Rule') {
                        taggedFinding.rule = result.rule.filename;
                    }
                    allFindings.push(taggedFinding);
                }
            }
        }
        
        const originalCount = allFindings.length;
        
        // If no findings, skip AI call
        if (allFindings.length === 0) {
            const reduceTimeMs = Date.now() - startTime;
            return {
                findings: [],
                summary: {
                    totalFindings: 0,
                    bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                    byRule: {},
                    overallAssessment: 'pass',
                    summaryText: 'No issues found. The code follows all provided rules.'
                },
                reduceStats: {
                    originalCount: 0,
                    dedupedCount: 0,
                    mergedCount: 0,
                    reduceTimeMs,
                    usedAIReduce: false
                }
            };
        }
        
        // Build AI reduce prompt
        const prompt = this.buildReducePrompt(allFindings, ruleResults, context);
        
        try {
            const result = await this.invokeAI(prompt);
            
            if (result.success && result.response) {
                const parsed = this.parseAIResponse(result.response, allFindings, ruleResults);
                const reduceTimeMs = Date.now() - startTime;
                
                return {
                    ...parsed,
                    reduceStats: {
                        originalCount,
                        dedupedCount: parsed.findings.length,
                        mergedCount: originalCount - parsed.findings.length,
                        reduceTimeMs,
                        usedAIReduce: true
                    }
                };
            }
            
            // AI failed, fall back to deterministic
            console.warn('AI reduce failed, falling back to deterministic:', result.error);
            const fallbackResult = await this.fallbackReducer.reduce(ruleResults, context);
            fallbackResult.reduceStats.usedAIReduce = false;
            return fallbackResult;
            
        } catch (error) {
            // On any error, fall back to deterministic
            console.warn('AI reduce error, falling back to deterministic:', error);
            const fallbackResult = await this.fallbackReducer.reduce(ruleResults, context);
            fallbackResult.reduceStats.usedAIReduce = false;
            return fallbackResult;
        }
    }
    
    /**
     * Build the prompt for AI reduce
     */
    private buildReducePrompt(
        findings: ReviewFinding[],
        ruleResults: SingleRuleReviewResult[],
        context: ReduceContext
    ): string {
        // Format findings for the prompt
        const formattedFindings = this.formatFindingsForPrompt(findings);
        
        // Build prompt from template
        let prompt = AI_REDUCE_PROMPT_TEMPLATE
            .replace('{{filesChanged}}', String(context.filesChanged))
            .replace('{{reviewType}}', context.isHotfix ? 'hotfix' : 'standard')
            .replace('{{findingsCount}}', String(findings.length))
            .replace('{{rulesCount}}', String(ruleResults.length))
            .replace('{{formattedFindings}}', formattedFindings);
        
        return prompt;
    }
    
    /**
     * Format findings for inclusion in the prompt
     */
    private formatFindingsForPrompt(findings: ReviewFinding[]): string {
        // Group by file for easier reading
        const byFile = new Map<string, ReviewFinding[]>();
        for (const finding of findings) {
            const file = finding.file || 'global';
            if (!byFile.has(file)) {
                byFile.set(file, []);
            }
            byFile.get(file)!.push(finding);
        }
        
        let output = '';
        for (const [file, fileFindings] of byFile) {
            output += `\n### ${file}\n`;
            for (const f of fileFindings) {
                output += `- [${f.rule}] Line ${f.line || 'N/A'}: ${f.description}\n`;
                if (f.codeSnippet) {
                    output += `  Snippet: \`${f.codeSnippet.substring(0, 100)}\`\n`;
                }
                if (f.suggestion) {
                    output += `  Suggestion: ${f.suggestion}\n`;
                }
            }
        }
        return output;
    }
    
    /**
     * Parse the AI response and convert to ReduceResult
     */
    private parseAIResponse(
        response: string,
        originalFindings: ReviewFinding[],
        ruleResults: SingleRuleReviewResult[]
    ): { findings: ReviewFinding[]; summary: ReviewSummary } {
        try {
            // Try to extract JSON from the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            
            const parsed: AIReduceResponse = JSON.parse(jsonMatch[0]);
            
            // Convert AI findings to ReviewFinding format
            const findings: ReviewFinding[] = parsed.findings.map((f, idx) => ({
                id: f.id || `ai-reduce-${idx}`,
                severity: this.mapSeverity(f.severity),
                rule: f.fromRules?.join(', ') || 'synthesized',
                file: f.file,
                line: f.line,
                description: f.issue,
                suggestion: f.suggestion
            }));
            
            // Build summary
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
            
            // Map overall severity
            let overallAssessment: 'pass' | 'needs-attention' | 'fail' = 'pass';
            switch (parsed.overallSeverity) {
                case 'critical':
                case 'needs-work':
                    overallAssessment = 'fail';
                    break;
                case 'minor-issues':
                    overallAssessment = 'needs-attention';
                    break;
                case 'clean':
                default:
                    overallAssessment = 'pass';
            }
            
            // Override with errors if present
            if (bySeverity.error > 0) {
                overallAssessment = 'fail';
            } else if (bySeverity.warning > 0 && overallAssessment === 'pass') {
                overallAssessment = 'needs-attention';
            }
            
            const summary: ReviewSummary = {
                totalFindings: findings.length,
                bySeverity,
                byRule,
                overallAssessment,
                summaryText: parsed.summary || `Found ${findings.length} issues after AI synthesis.`
            };
            
            return { findings, summary };
            
        } catch (error) {
            // If parsing fails, use deterministic approach on original findings
            console.warn('Failed to parse AI reduce response:', error);
            const deterministicReducer = new DeterministicReducer();
            // Create a mock context to call deterministic reducer synchronously
            const sortedFindings = this.sortByImportance(originalFindings);
            
            const bySeverity = { error: 0, warning: 0, info: 0, suggestion: 0 };
            const byRule: Record<string, number> = {};
            
            for (const finding of sortedFindings) {
                bySeverity[finding.severity]++;
                byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
            }
            
            let overallAssessment: 'pass' | 'needs-attention' | 'fail' = 'pass';
            if (bySeverity.error > 0) {
                overallAssessment = 'fail';
            } else if (bySeverity.warning > 0) {
                overallAssessment = 'needs-attention';
            }
            
            return {
                findings: sortedFindings,
                summary: {
                    totalFindings: sortedFindings.length,
                    bySeverity,
                    byRule,
                    overallAssessment,
                    summaryText: `Found ${sortedFindings.length} issues.`
                }
            };
        }
    }
    
    /**
     * Map severity string from AI response to ReviewSeverity
     */
    private mapSeverity(severity: string): ReviewSeverity {
        const lower = severity.toLowerCase();
        if (lower === 'error' || lower === 'critical') {
            return 'error';
        }
        if (lower === 'warning' || lower === 'major') {
            return 'warning';
        }
        if (lower === 'info' || lower === 'minor') {
            return 'info';
        }
        return 'suggestion';
    }
    
    /**
     * Sort findings by importance (simple fallback)
     */
    private sortByImportance(findings: ReviewFinding[]): ReviewFinding[] {
        const severityOrder: Record<ReviewSeverity, number> = {
            'error': 0,
            'warning': 1,
            'info': 2,
            'suggestion': 3
        };
        
        return [...findings].sort((a, b) =>
            severityOrder[a.severity] - severityOrder[b.severity]
        );
    }
}

/**
 * Factory function to create the appropriate reducer based on mode
 */
export function createReducer(
    mode: CodeReviewReduceMode,
    invokeAI?: (prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>
): Reducer {
    if (mode === 'ai' && invokeAI) {
        return new AIReducer(invokeAI);
    }
    return new DeterministicReducer();
}
