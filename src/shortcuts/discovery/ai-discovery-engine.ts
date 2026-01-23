/**
 * AI-Powered Discovery Engine
 * 
 * Replaces keyword-based discovery with true AI-powered semantic search.
 * Uses the Copilot SDK (preferred) or CLI (fallback) to autonomously explore
 * the codebase to find all documentation, source code, tests, and recent commits
 * related to a feature.
 * 
 * Backend Selection:
 * - copilot-sdk: Use the @github/copilot-sdk for structured JSON-RPC communication (recommended)
 * - copilot-cli: Use the copilot CLI via child process (fallback)
 * 
 * The engine automatically falls back to CLI if SDK is unavailable or fails.
 */

import * as vscode from 'vscode';
import { exec, ChildProcess } from 'child_process';
import { escapeShellArg, getAIModelSetting, getWorkingDirectory } from '../ai-service/copilot-cli-invoker';
import { getCopilotSDKService, getAIBackendSetting } from '../ai-service/copilot-sdk-service';
import { getExtensionLogger, LogCategory } from '../shared/extension-logger';
import {
    DiscoveryRequest,
    DiscoveryProcess,
    DiscoveryResult,
    DiscoveryPhase,
    DiscoveryEvent,
    DiscoveryEventType,
    DiscoverySourceType,
    DiscoveryCommitInfo,
    ExistingGroupSnapshot
} from './types';

/**
 * Configuration for AI discovery
 */
export interface AIDiscoveryConfig {
    /** Feature flag for AI discovery */
    enabled: boolean;
    /** AI model to use (optional, uses default if not specified) */
    model?: string;
    /** Maximum wait time in seconds (default: 120s) */
    timeout: number;
    /** Maximum number of results to return (default: 30) */
    maxResults: number;
    /** Minimum relevance score to include (default: 40) */
    minRelevance: number;
    /** Directories to prioritize in search */
    focusAreas?: string[];
    /** Patterns to exclude from search */
    excludePatterns?: string[];
}

/**
 * Default AI discovery configuration
 */
export const DEFAULT_AI_DISCOVERY_CONFIG: AIDiscoveryConfig = {
    enabled: true,
    timeout: 120,
    maxResults: 30,
    minRelevance: 40
};

/**
 * Result item from AI discovery
 */
export interface AIDiscoveryItem {
    type: 'source' | 'test' | 'doc' | 'config' | 'commit';
    path?: string;
    hash?: string;
    message?: string;
    relevance: number;
    reason: string;
    category: 'core' | 'supporting' | 'related' | 'tangential';
}

/**
 * Structured response from AI discovery
 */
export interface AIDiscoveryResponse {
    feature: string;
    summary: string;
    results: AIDiscoveryItem[];
}

/**
 * Build the existing items section for the prompt
 * Exported for testing purposes
 */
export function buildExistingItemsSection(existingGroupSnapshot?: ExistingGroupSnapshot): string {
    if (!existingGroupSnapshot || existingGroupSnapshot.items.length === 0) {
        return '';
    }

    const fileItems = existingGroupSnapshot.items
        .filter(item => item.type === 'file' || item.type === 'folder')
        .map(item => item.path)
        .filter(Boolean);
    
    const commitItems = existingGroupSnapshot.items
        .filter(item => item.type === 'commit')
        .map(item => item.commitHash)
        .filter(Boolean);

    const parts: string[] = [];
    
    if (fileItems.length > 0) {
        parts.push(`Files/folders already in group:\n${fileItems.map(p => `  - ${p}`).join('\n')}`);
    }
    
    if (commitItems.length > 0) {
        parts.push(`Commits already in group:\n${commitItems.map(h => `  - ${h}`).join('\n')}`);
    }

    if (parts.length === 0) {
        return '';
    }

    return `\n## Existing Items to Skip
The following items are already in the group "${existingGroupSnapshot.name}" and should NOT be included in results:
${parts.join('\n\n')}
`;
}

/**
 * Build the discovery prompt for the AI
 */
function buildDiscoveryPrompt(
    featureDescription: string,
    config: AIDiscoveryConfig,
    existingGroupSnapshot?: ExistingGroupSnapshot
): string {
    const focusAreasSection = config.focusAreas && config.focusAreas.length > 0
        ? `\n## Priority Areas\nFocus on these directories first: ${config.focusAreas.join(', ')}`
        : '';

    const excludeSection = config.excludePatterns && config.excludePatterns.length > 0
        ? `\n## Excluded Patterns\nSkip files matching: ${config.excludePatterns.join(', ')}`
        : '';

    const existingItemsSection = buildExistingItemsSection(existingGroupSnapshot);

    return `You are a code exploration agent. Find all files and commits related to a feature.

## Feature to find
${featureDescription}
${focusAreasSection}
${excludeSection}
${existingItemsSection}
## Instructions

1. First, think about what search terms would find this feature:
   - Direct terms (exact matches)
   - Semantic terms (related concepts)
   - Code patterns (function names, types, modules)

2. Search the codebase:
   - Use Grep to search for relevant terms in source files
   - Use Glob to find files in likely locations
   - Use Bash to run: git log --oneline -n 50 --grep="<term>" for each relevant term
   - Read promising files to verify relevance

3. For each result, assess:
   - How directly related is it? (core implementation vs tangential)
   - What role does it play? (source, test, doc, config, commit)

4. Return ONLY a JSON object (no markdown, no explanation):

{
  "feature": "${featureDescription}",
  "summary": "Brief summary of what you found",
  "results": [
    {
      "type": "source|test|doc|config|commit",
      "path": "relative/path/to/file.rs",
      "hash": "abc1234",
      "message": "commit message",
      "relevance": 95,
      "reason": "Why this is relevant (1 sentence)",
      "category": "core|supporting|related|tangential"
    }
  ]
}

## Constraints
- Maximum ${config.maxResults} results
- Minimum relevance score: ${config.minRelevance}
- Sort by relevance (highest first)
- Include at least: source files, tests (if found), recent commits
- For commits: include both "hash" and "message" fields
- For files: include "path" field (relative to repository root)${existingGroupSnapshot ? '\n- Do NOT include any items listed in "Existing Items to Skip"' : ''}`;
}

/**
 * Parse the AI response to extract the JSON result
 */
export function parseDiscoveryResponse(response: string): AIDiscoveryResponse {
    // Remove ANSI escape codes
    let cleanResponse = response.replace(/\x1b\[[0-9;]*m/g, '');
    
    // Try to extract JSON from markdown code blocks first
    const jsonMatch = cleanResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        cleanResponse = jsonMatch[1];
    }

    // Try to find a JSON object
    const objectMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
        throw new Error('No JSON object found in AI response');
    }

    try {
        const parsed = JSON.parse(objectMatch[0]);
        
        // Validate the structure
        if (!parsed.feature || !parsed.summary || !Array.isArray(parsed.results)) {
            throw new Error('Invalid response structure: missing required fields');
        }

        // Validate and normalize results
        const validatedResults: AIDiscoveryItem[] = [];
        for (const item of parsed.results) {
            if (typeof item.relevance !== 'number' || item.relevance < 0 || item.relevance > 100) {
                continue; // Skip invalid items
            }
            
            const validTypes = ['source', 'test', 'doc', 'config', 'commit'];
            if (!validTypes.includes(item.type)) {
                continue;
            }

            // Commits must have hash, files must have path
            if (item.type === 'commit' && !item.hash) {
                continue;
            }
            if (item.type !== 'commit' && !item.path) {
                continue;
            }

            validatedResults.push({
                type: item.type,
                path: item.path,
                hash: item.hash,
                message: item.message,
                relevance: Math.round(item.relevance),
                reason: item.reason || 'Matched search criteria',
                category: ['core', 'supporting', 'related', 'tangential'].includes(item.category) 
                    ? item.category 
                    : 'related'
            });
        }

        return {
            feature: parsed.feature,
            summary: parsed.summary,
            results: validatedResults
        };
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse JSON: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Convert AI discovery items to DiscoveryResult format
 */
function convertToDiscoveryResults(
    items: AIDiscoveryItem[],
    repositoryRoot: string
): DiscoveryResult[] {
    return items.map((item, index) => {
        let type: DiscoverySourceType;
        let name: string;
        let commit: DiscoveryCommitInfo | undefined;

        if (item.type === 'commit') {
            type = 'commit';
            name = item.message || `Commit ${item.hash?.substring(0, 7)}`;
            commit = {
                hash: item.hash!,
                shortHash: item.hash!.substring(0, 7),
                subject: item.message || '',
                authorName: '',
                date: new Date().toISOString(),
                repositoryRoot
            };
        } else {
            // Map AI types to our types
            type = item.type === 'doc' ? 'doc' : 'file';
            name = item.path!.split('/').pop() || item.path!;
        }

        return {
            id: item.type === 'commit' 
                ? `commit:${item.hash}` 
                : `file:${item.path}`,
            type,
            name,
            path: item.path,
            commit,
            relevanceScore: item.relevance,
            matchedKeywords: [], // AI doesn't provide keywords, but gives reasons
            relevanceReason: item.reason,
            selected: false
        };
    });
}

/**
 * AI-Powered Discovery Engine
 * Uses Copilot SDK (preferred) or CLI (fallback) to semantically search the codebase.
 * 
 * The engine supports cancellation via:
 * - SDK: Uses session abort mechanism
 * - CLI: Uses child process kill
 */
export class AIDiscoveryEngine implements vscode.Disposable {
    private readonly _onDidChangeProcess = new vscode.EventEmitter<DiscoveryEvent>();
    readonly onDidChangeProcess = this._onDidChangeProcess.event;

    private processes: Map<string, DiscoveryProcess> = new Map();
    private runningProcesses: Map<string, ChildProcess> = new Map();
    /** Tracks SDK session IDs for processes (for cancellation) */
    private sdkSessionIds: Map<string, string> = new Map();
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(this._onDidChangeProcess);
    }

    /**
     * Get the AI discovery configuration from VS Code settings
     */
    getConfig(): AIDiscoveryConfig {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.discovery');
        
        return {
            enabled: config.get<boolean>('enabled', true),
            timeout: config.get<number>('aiTimeout', DEFAULT_AI_DISCOVERY_CONFIG.timeout),
            maxResults: config.get<number>('maxResults', DEFAULT_AI_DISCOVERY_CONFIG.maxResults),
            minRelevance: config.get<number>('minRelevance', DEFAULT_AI_DISCOVERY_CONFIG.minRelevance),
            focusAreas: config.get<string[]>('focusAreas', []),
            excludePatterns: config.get<string[]>('excludePatterns', [])
        };
    }

    /**
     * Start a new AI-powered discovery process.
     * Uses SDK backend if configured and available, falls back to CLI otherwise.
     */
    async discover(request: DiscoveryRequest): Promise<DiscoveryProcess> {
        // Create new process
        const process = this.createProcess(request);
        this.processes.set(process.id, process);
        this.emitEvent('process-started', process);

        try {
            // Get configuration
            const config = this.getConfig();

            // Phase 1: Preparing AI query
            await this.updatePhase(process, 'extracting-keywords', 5);

            // Build the prompt with existing group snapshot if available
            const prompt = buildDiscoveryPrompt(
                request.featureDescription,
                {
                    ...config,
                    focusAreas: config.focusAreas,
                    excludePatterns: request.scope.excludePatterns
                },
                request.existingGroupSnapshot
            );

            // Phase 2: AI is exploring the codebase
            await this.updatePhase(process, 'scanning-files', 10);

            // Try SDK first if configured, fall back to CLI
            const result = await this.invokeAI(
                prompt,
                request.repositoryRoot,
                config.timeout,
                process.id
            );

            if (!result.success) {
                throw new Error(result.error || 'AI discovery failed');
            }

            // Phase 3: Parsing results
            await this.updatePhase(process, 'scoring-relevance', 80);

            // Parse the AI response
            const parsed = parseDiscoveryResponse(result.response!);

            // Convert to DiscoveryResult format
            const results = convertToDiscoveryResults(
                parsed.results,
                request.repositoryRoot
            );

            // Phase 4: Complete
            await this.updatePhase(process, 'completed', 100);
            process.status = 'completed';
            process.results = results;
            process.endTime = new Date();

            this.emitEvent('process-completed', process);

            return process;

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            const logger = getExtensionLogger();
            logger.error(LogCategory.DISCOVERY, 'AI Discovery failed', err, {
                processId: process.id,
                featureDescription: request.featureDescription
            });

            process.status = 'failed';
            process.error = err.message;
            process.endTime = new Date();

            this.emitEvent('process-failed', process);

            return process;
        } finally {
            // Clean up running process references
            this.runningProcesses.delete(process.id);
            this.sdkSessionIds.delete(process.id);
        }
    }

    /**
     * Invoke AI using SDK (if configured and available) or CLI (fallback).
     * This method handles backend selection and automatic fallback.
     */
    private async invokeAI(
        prompt: string,
        workspaceRoot: string,
        timeoutSeconds: number,
        processId: string
    ): Promise<{ success: boolean; response?: string; error?: string }> {
        const logger = getExtensionLogger();
        const backend = getAIBackendSetting();

        // Try SDK if configured
        if (backend === 'copilot-sdk') {
            logger.debug(LogCategory.DISCOVERY, `AI Discovery: Attempting SDK backend for process ${processId}`);
            
            const sdkResult = await this.invokeCopilotSDK(
                prompt,
                workspaceRoot,
                timeoutSeconds,
                processId
            );

            if (sdkResult.success) {
                return sdkResult;
            }

            // SDK failed, fall back to CLI
            logger.debug(LogCategory.DISCOVERY, `AI Discovery: SDK failed, falling back to CLI - ${sdkResult.error}`);
        }

        // Use CLI (either as primary backend or as fallback)
        logger.debug(LogCategory.DISCOVERY, `AI Discovery: Using CLI backend for process ${processId}`);
        return this.invokeCopilotCLI(
            prompt,
            workspaceRoot,
            timeoutSeconds,
            processId
        );
    }

    /**
     * Invoke Copilot SDK for discovery.
     * Uses direct mode (session-per-request) since discovery is a one-off operation.
     */
    private async invokeCopilotSDK(
        prompt: string,
        workspaceRoot: string,
        timeoutSeconds: number,
        processId: string
    ): Promise<{ success: boolean; response?: string; error?: string }> {
        const logger = getExtensionLogger();
        const startTime = Date.now();
        const sdkService = getCopilotSDKService();

        logger.logOperationStart(LogCategory.DISCOVERY, 'AI discovery SDK invocation', {
            processId,
            workingDirectory: workspaceRoot,
            timeoutSeconds
        });

        // Check SDK availability
        const availability = await sdkService.isAvailable();
        if (!availability.available) {
            logger.debug(LogCategory.DISCOVERY, `AI Discovery SDK: Not available - ${availability.error}`);
            return {
                success: false,
                error: availability.error || 'Copilot SDK is not available'
            };
        }

        try {
            // Send message using direct mode (creates new session, destroys after)
            // Discovery is a one-off operation, so we don't use the pool
            const result = await sdkService.sendMessage({
                prompt,
                workingDirectory: workspaceRoot,
                timeoutMs: timeoutSeconds * 1000,
                usePool: false
            });

            const durationMs = Date.now() - startTime;

            // Track the session ID for potential cancellation
            if (result.sessionId) {
                this.sdkSessionIds.set(processId, result.sessionId);
            }

            if (result.success) {
                logger.logOperationComplete(LogCategory.DISCOVERY, 'AI discovery SDK invocation', durationMs, {
                    processId,
                    responseLength: result.response?.length || 0
                });
                return {
                    success: true,
                    response: result.response
                };
            }

            logger.logOperationFailed(LogCategory.DISCOVERY, 'AI discovery SDK invocation', undefined, {
                processId,
                durationMs,
                error: result.error
            });
            return {
                success: false,
                error: result.error
            };
        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            logger.logOperationFailed(LogCategory.DISCOVERY, 'AI discovery SDK invocation', error instanceof Error ? error : undefined, {
                processId,
                durationMs
            });
            return {
                success: false,
                error: `Copilot SDK error: ${errorMessage}`
            };
        }
    }

    /**
     * Invoke Copilot CLI and capture output
     */
    private async invokeCopilotCLI(
        prompt: string,
        workspaceRoot: string,
        timeoutSeconds: number,
        processId: string
    ): Promise<{ success: boolean; response?: string; error?: string }> {
        const logger = getExtensionLogger();
        const startTime = Date.now();
        
        return new Promise((resolve) => {
            const escapedPrompt = escapeShellArg(prompt);
            const model = getAIModelSetting();
            const cwd = getWorkingDirectory(workspaceRoot);

            let command = `copilot --allow-all-tools -p ${escapedPrompt}`;
            if (model) {
                command = `copilot --allow-all-tools --model ${model} -p ${escapedPrompt}`;
            }

            logger.logOperationStart(LogCategory.DISCOVERY, 'AI discovery CLI invocation', {
                processId,
                workingDirectory: cwd,
                model: model || 'default',
                timeoutSeconds
            });

            const childProcess = exec(command, {
                cwd,
                timeout: timeoutSeconds * 1000,
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            }, (error, stdout, stderr) => {
                const durationMs = Date.now() - startTime;
                
                if (error) {
                    if (error.killed) {
                        const errorMsg = `AI discovery timed out after ${timeoutSeconds} seconds`;
                        logger.logOperationFailed(LogCategory.DISCOVERY, 'AI discovery CLI invocation', error, {
                            processId,
                            durationMs,
                            reason: 'timeout',
                            timeoutSeconds
                        });
                        resolve({
                            success: false,
                            error: errorMsg
                        });
                        return;
                    }

                    if (error.message.includes('command not found') ||
                        error.message.includes('not recognized')) {
                        const errorMsg = 'Copilot CLI is not installed. Please install it with: npm install -g @anthropic-ai/claude-code';
                        logger.logOperationFailed(LogCategory.DISCOVERY, 'AI discovery CLI invocation', error, {
                            processId,
                            durationMs,
                            reason: 'cli_not_found'
                        });
                        resolve({
                            success: false,
                            error: errorMsg
                        });
                        return;
                    }

                    logger.logOperationFailed(LogCategory.DISCOVERY, 'AI discovery CLI invocation', error, {
                        processId,
                        durationMs,
                        reason: 'cli_error',
                        stderr: stderr ? stderr.substring(0, 500) : undefined
                    });
                    resolve({
                        success: false,
                        error: `Copilot CLI error: ${error.message}`
                    });
                    return;
                }

                // Parse the output to extract just the response
                const response = this.parseCopilotOutput(stdout);

                if (!response) {
                    logger.logOperationFailed(LogCategory.DISCOVERY, 'AI discovery CLI invocation', undefined, {
                        processId,
                        durationMs,
                        reason: 'empty_response',
                        stdoutLength: stdout?.length || 0
                    });
                    resolve({
                        success: false,
                        error: 'No response received from Copilot CLI'
                    });
                    return;
                }

                logger.logOperationComplete(LogCategory.DISCOVERY, 'AI discovery CLI invocation', durationMs, {
                    processId,
                    responseLength: response.length
                });
                resolve({
                    success: true,
                    response
                });
            });

            // Store reference for cancellation
            this.runningProcesses.set(processId, childProcess);
        });
    }

    /**
     * Parse Copilot CLI output to extract the response
     */
    private parseCopilotOutput(output: string): string {
        const lines = output.split('\n');
        const resultLines: string[] = [];
        let inContent = false;

        for (const line of lines) {
            // Skip ANSI escape codes and clean the line
            const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();

            // Skip empty lines at the start
            if (!inContent && cleanLine === '') {
                continue;
            }

            // Skip copilot status/operation lines
            if (cleanLine.startsWith('✓') ||
                cleanLine.startsWith('✗') ||
                cleanLine.startsWith('└') ||
                cleanLine.startsWith('├')) {
                continue;
            }

            // Skip error/info messages from copilot tools
            if (cleanLine.startsWith('Invalid session') ||
                cleanLine.includes('session ID') ||
                cleanLine.startsWith('Error:') ||
                cleanLine.startsWith('Warning:')) {
                continue;
            }

            // Skip lines that look like tool invocations
            if (cleanLine.match(/^(Read|Glob|Search|List|Edit|Write|Delete|Run)\s/i)) {
                continue;
            }

            // Stop at usage statistics
            if (cleanLine.startsWith('Total usage') ||
                cleanLine.startsWith('Total duration') ||
                cleanLine.startsWith('Total code changes') ||
                cleanLine.startsWith('Usage by model')) {
                break;
            }

            // Start capturing content
            inContent = true;
            resultLines.push(cleanLine);
        }

        // Trim trailing empty lines
        while (resultLines.length > 0 && resultLines[resultLines.length - 1] === '') {
            resultLines.pop();
        }

        return resultLines.join('\n').trim();
    }

    /**
     * Cancel a running discovery process.
     * Supports both SDK session abort and CLI child process kill.
     */
    cancelProcess(processId: string): void {
        const process = this.processes.get(processId);
        if (process && process.status === 'running') {
            const logger = getExtensionLogger();

            // Try to abort SDK session if it exists
            const sessionId = this.sdkSessionIds.get(processId);
            if (sessionId) {
                logger.debug(LogCategory.DISCOVERY, `AI Discovery: Aborting SDK session ${sessionId} for process ${processId}`);
                const sdkService = getCopilotSDKService();
                // Fire and forget - we don't need to wait for the abort to complete
                sdkService.abortSession(sessionId).catch(error => {
                    logger.debug(LogCategory.DISCOVERY, `AI Discovery: Warning: Error aborting SDK session: ${error}`);
                });
                this.sdkSessionIds.delete(processId);
            }

            // Kill the child process if running (CLI backend)
            const childProcess = this.runningProcesses.get(processId);
            if (childProcess) {
                logger.debug(LogCategory.DISCOVERY, `AI Discovery: Killing CLI child process for process ${processId}`);
                childProcess.kill();
                this.runningProcesses.delete(processId);
            }

            process.status = 'cancelled';
            process.endTime = new Date();
            this.emitEvent('process-cancelled', process);
        }
    }

    /**
     * Get a process by ID
     */
    getProcess(processId: string): DiscoveryProcess | undefined {
        return this.processes.get(processId);
    }

    /**
     * Get all processes
     */
    getAllProcesses(): DiscoveryProcess[] {
        return Array.from(this.processes.values());
    }

    /**
     * Clear completed/failed/cancelled processes
     */
    clearCompletedProcesses(): void {
        for (const [id, process] of this.processes.entries()) {
            if (process.status !== 'running') {
                this.processes.delete(id);
            }
        }
    }

    /**
     * Create a new discovery process
     */
    private createProcess(request: DiscoveryRequest): DiscoveryProcess {
        return {
            id: `ai_discovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            status: 'running',
            featureDescription: request.featureDescription,
            phase: 'initializing',
            progress: 0,
            startTime: new Date(),
            targetGroupPath: request.targetGroupPath
        };
    }

    /**
     * Update process phase
     */
    private async updatePhase(
        process: DiscoveryProcess,
        phase: DiscoveryPhase,
        progress: number
    ): Promise<void> {
        if (process.status !== 'running') {
            throw new Error('Process was cancelled');
        }

        process.phase = phase;
        process.progress = progress;
        this.emitEvent('process-updated', process);

        // Small delay to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    /**
     * Emit a process event
     */
    private emitEvent(type: DiscoveryEventType, process: DiscoveryProcess): void {
        this._onDidChangeProcess.fire({ type, process });
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        const logger = getExtensionLogger();

        // Cancel all running processes
        for (const [id, childProcess] of this.runningProcesses.entries()) {
            logger.debug(LogCategory.DISCOVERY, `AI Discovery: Killing CLI child process ${id} during dispose`);
            childProcess.kill();
        }
        this.runningProcesses.clear();

        // Abort all SDK sessions
        const sdkService = getCopilotSDKService();
        for (const [processId, sessionId] of this.sdkSessionIds.entries()) {
            logger.debug(LogCategory.DISCOVERY, `AI Discovery: Aborting SDK session ${sessionId} (process ${processId}) during dispose`);
            sdkService.abortSession(sessionId).catch(() => {
                // Ignore errors during dispose
            });
        }
        this.sdkSessionIds.clear();

        this.processes.clear();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

/**
 * Create a discovery request for the AI engine
 */
export function createAIDiscoveryRequest(
    featureDescription: string,
    repositoryRoot: string,
    options?: {
        keywords?: string[];
        targetGroupPath?: string;
        scope?: Partial<{
            includeSourceFiles: boolean;
            includeDocs: boolean;
            includeConfigFiles: boolean;
            includeGitHistory: boolean;
            maxCommits: number;
            excludePatterns: string[];
        }>;
        existingGroupSnapshot?: ExistingGroupSnapshot;
    }
): DiscoveryRequest {
    const defaultScope = {
        includeSourceFiles: true,
        includeDocs: true,
        includeConfigFiles: true,
        includeGitHistory: true,
        maxCommits: 50,
        excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/out/**', '**/build/**']
    };

    return {
        featureDescription,
        keywords: options?.keywords,
        scope: {
            ...defaultScope,
            ...options?.scope
        },
        targetGroupPath: options?.targetGroupPath,
        repositoryRoot,
        existingGroupSnapshot: options?.existingGroupSnapshot
    };
}

