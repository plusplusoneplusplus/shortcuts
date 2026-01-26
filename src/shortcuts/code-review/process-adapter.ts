/**
 * Code Review Process Adapter
 * 
 * This adapter bridges the code-review module to the generic AI process manager.
 * It provides a code-review-specific interface while using the generic API internally,
 * enabling decoupling between the code-review module and the ai-service module.
 * 
 * The adapter pattern allows:
 * 1. Code-review to define its own metadata types locally
 * 2. AI-service to remain domain-agnostic
 * 3. Easy testing by mocking the adapter
 * 4. Future migration to fully generic API without changing code-review logic
 */

import { ChildProcess } from 'child_process';
import { AIProcess, GenericProcessMetadata, GenericGroupMetadata, IAIProcessManager } from '../ai-service';
import type { RuleReviewResult, ReviewFinding as MRReviewFinding } from '@plusplusoneplusplus/pipeline-core';
import { CodeReviewMetadata, DiffStats, ReviewFinding, ReviewSummary } from './types';

/**
 * Code review process metadata (local to code-review module)
 * This mirrors the legacy CodeReviewProcessMetadata but is owned by this module.
 */
export interface CodeReviewProcessData {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged' | 'range';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message */
    commitMessage?: string;
    /** Rules used for the review */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: DiffStats;
}

/**
 * Code review group metadata (local to code-review module)
 */
export interface CodeReviewGroupData extends CodeReviewProcessData {
    /** Child process IDs (individual rule reviews) */
    childProcessIds: string[];
    /** Execution statistics */
    executionStats?: {
        totalRules: number;
        successfulRules: number;
        failedRules: number;
        totalTimeMs: number;
    };
}

/**
 * Process type constants for code review
 */
export const CODE_REVIEW_PROCESS_TYPE = 'code-review';
export const CODE_REVIEW_GROUP_TYPE = 'code-review-group';

/**
 * Convert CodeReviewProcessData to GenericProcessMetadata
 */
function toGenericMetadata(data: CodeReviewProcessData): GenericProcessMetadata {
    return {
        type: CODE_REVIEW_PROCESS_TYPE,
        reviewType: data.reviewType,
        commitSha: data.commitSha,
        commitMessage: data.commitMessage,
        rulesUsed: data.rulesUsed,
        diffStats: data.diffStats
    };
}

/**
 * Convert CodeReviewGroupData to GenericGroupMetadata
 */
function toGenericGroupMetadata(data: Omit<CodeReviewGroupData, 'childProcessIds'>): Omit<GenericGroupMetadata, 'childProcessIds'> {
    return {
        type: CODE_REVIEW_GROUP_TYPE,
        reviewType: data.reviewType,
        commitSha: data.commitSha,
        commitMessage: data.commitMessage,
        rulesUsed: data.rulesUsed,
        diffStats: data.diffStats
    };
}

/**
 * Adapter interface for code review process tracking.
 * This interface is what the code-review-commands.ts should use.
 */
export interface ICodeReviewProcessAdapter {
    /**
     * Register a code review process
     * @param prompt The full prompt
     * @param data Code review specific data
     * @param childProcess Optional child process reference
     * @param parentProcessId Optional parent group ID
     * @returns Process ID
     */
    registerProcess(
        prompt: string,
        data: CodeReviewProcessData,
        childProcess?: ChildProcess,
        parentProcessId?: string
    ): string;

    /**
     * Register a code review group (for parallel reviews)
     * @param data Group data (without childProcessIds - managed internally)
     * @returns Group process ID
     */
    registerGroup(data: Omit<CodeReviewGroupData, 'childProcessIds' | 'executionStats'>): string;

    /**
     * Complete a code review group
     * @param groupId Group process ID
     * @param result Summary result text
     * @param structuredResult Structured result as JSON string
     * @param executionStats Execution statistics
     */
    completeGroup(
        groupId: string,
        result: string,
        structuredResult: string,
        executionStats: CodeReviewGroupData['executionStats']
    ): void;

    /**
     * Update process status
     * @param processId Process ID
     * @param status New status
     * @param response Optional response
     * @param error Optional error
     */
    updateProcess(
        processId: string,
        status: 'running' | 'completed' | 'failed',
        response?: string,
        error?: string
    ): void;

    /**
     * Update structured result for a process
     * @param processId Process ID
     * @param structuredResult Structured result JSON
     */
    updateStructuredResult(processId: string, structuredResult: string): void;

    /**
     * Get a process by ID
     * @param processId Process ID
     * @returns Process or undefined
     */
    getProcess(processId: string): AIProcess | undefined;

    /**
     * Get child processes for a group
     * @param groupId Group process ID
     * @returns Child processes
     */
    getChildProcesses(groupId: string): AIProcess[];
}

/**
 * Code Review Process Adapter implementation.
 * 
 * This adapter can use either:
 * 1. The new generic API (preferred, for future-proofing)
 * 2. The legacy API (for backward compatibility during migration)
 * 
 * Currently uses the legacy API to maintain compatibility with existing tests
 * and stored processes. Can be switched to generic API when ready.
 */
export class CodeReviewProcessAdapter implements ICodeReviewProcessAdapter {
    private readonly groupIds: Map<string, string> = new Map(); // Maps group ID to internal tracking

    constructor(
        private readonly processManager: IAIProcessManager,
        private readonly useGenericApi: boolean = false // Toggle for migration
    ) {}

    registerProcess(
        prompt: string,
        data: CodeReviewProcessData,
        childProcess?: ChildProcess,
        parentProcessId?: string
    ): string {
        if (this.useGenericApi) {
            // Use new generic API
            return this.processManager.registerTypedProcess(
                prompt,
                {
                    type: CODE_REVIEW_PROCESS_TYPE,
                    idPrefix: 'review',
                    metadata: toGenericMetadata(data),
                    parentProcessId
                },
                childProcess
            );
        } else {
            // Use legacy API for compatibility
            return this.processManager.registerCodeReviewProcess(
                prompt,
                {
                    reviewType: data.reviewType,
                    commitSha: data.commitSha,
                    commitMessage: data.commitMessage,
                    rulesUsed: data.rulesUsed,
                    diffStats: data.diffStats
                },
                childProcess,
                parentProcessId
            );
        }
    }

    registerGroup(data: Omit<CodeReviewGroupData, 'childProcessIds' | 'executionStats'>): string {
        if (this.useGenericApi) {
            // Use new generic API
            const prompt = `Code review group with ${data.rulesUsed.length} rules: ${data.rulesUsed.join(', ')}`;
            return this.processManager.registerProcessGroup(
                prompt,
                {
                    type: CODE_REVIEW_GROUP_TYPE,
                    idPrefix: 'review-group',
                    metadata: toGenericGroupMetadata(data)
                }
            );
        } else {
            // Use legacy API for compatibility
            return this.processManager.registerCodeReviewGroup({
                reviewType: data.reviewType,
                commitSha: data.commitSha,
                commitMessage: data.commitMessage,
                rulesUsed: data.rulesUsed,
                diffStats: data.diffStats
            });
        }
    }

    completeGroup(
        groupId: string,
        result: string,
        structuredResult: string,
        executionStats: CodeReviewGroupData['executionStats']
    ): void {
        if (this.useGenericApi) {
            // Use new generic API
            this.processManager.completeProcessGroup(groupId, {
                result,
                structuredResult,
                executionStats: executionStats ? {
                    totalRules: executionStats.totalRules,
                    successfulRules: executionStats.successfulRules,
                    failedRules: executionStats.failedRules,
                    totalTimeMs: executionStats.totalTimeMs
                } : undefined
            });
        } else {
            // Use legacy API for compatibility
            this.processManager.completeCodeReviewGroup(
                groupId,
                result,
                structuredResult,
                executionStats
            );
        }
    }

    updateProcess(
        processId: string,
        status: 'running' | 'completed' | 'failed',
        response?: string,
        error?: string
    ): void {
        this.processManager.updateProcess(processId, status, response, error);
    }

    updateStructuredResult(processId: string, structuredResult: string): void {
        this.processManager.updateProcessStructuredResult(processId, structuredResult);
    }

    getProcess(processId: string): AIProcess | undefined {
        return this.processManager.getProcess(processId);
    }

    getChildProcesses(groupId: string): AIProcess[] {
        return this.processManager.getChildProcesses(groupId);
    }
}

/**
 * Adapt map-reduce ReviewFinding to code-review ReviewFinding
 */
function adaptFinding(mrFinding: MRReviewFinding): ReviewFinding {
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

/**
 * Transform RuleReviewResult into CodeReviewResult format for the viewer
 */
function transformStructuredResult(
    structuredResult: string,
    metadata: CodeReviewMetadata
): string | null {
    try {
        const ruleResult = JSON.parse(structuredResult) as RuleReviewResult;
        const findings = ruleResult.findings?.map(adaptFinding) || [];
        
        // Create summary for this single rule
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
        
        // Build CodeReviewResult-compatible format
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
    } catch {
        // If transformation fails, return null to use the raw result
        return null;
    }
}

/**
 * Create a ProcessTracker compatible with the map-reduce framework
 * using the code review adapter.
 */
export function createCodeReviewProcessTracker(
    adapter: ICodeReviewProcessAdapter,
    metadata: CodeReviewMetadata
): import('@plusplusoneplusplus/pipeline-core').ProcessTracker & { groupId?: string; updateGroupStructuredResult(result: string): void } {
    let groupId: string | undefined;

    return {
        get groupId() { return groupId; },

        registerProcess(description: string, parentGroupId?: string): string {
            return adapter.registerProcess(
                description,
                {
                    reviewType: metadata.type,
                    commitSha: metadata.commitSha,
                    commitMessage: metadata.commitMessage,
                    rulesUsed: [],
                    diffStats: metadata.diffStats
                },
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
            adapter.updateProcess(processId, status, response, error);
            
            if (structuredResult && status === 'completed') {
                // Transform RuleReviewResult into CodeReviewResult format for the viewer
                const transformed = transformStructuredResult(structuredResult, metadata);
                adapter.updateStructuredResult(processId, transformed || structuredResult);
            }
        },

        registerGroup(description: string): string {
            const id = adapter.registerGroup({
                reviewType: metadata.type,
                commitSha: metadata.commitSha,
                commitMessage: metadata.commitMessage,
                rulesUsed: [],
                diffStats: metadata.diffStats
            });
            groupId = id;
            return id;
        },

        completeGroup(
            gId: string,
            summary: string,
            stats: import('@plusplusoneplusplus/pipeline-core').ExecutionStats
        ): void {
            adapter.completeGroup(
                gId,
                summary,
                JSON.stringify(stats), // Placeholder - will be updated with full result later
                {
                    totalRules: stats.totalItems,
                    successfulRules: stats.successfulMaps,
                    failedRules: stats.failedMaps,
                    totalTimeMs: stats.mapPhaseTimeMs + stats.reducePhaseTimeMs
                }
            );
        },

        updateGroupStructuredResult(structuredResult: string): void {
            if (groupId) {
                adapter.updateStructuredResult(groupId, structuredResult);
            }
        }
    };
}
