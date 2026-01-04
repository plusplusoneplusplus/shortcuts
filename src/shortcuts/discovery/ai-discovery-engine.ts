/**
 * AI-Powered Discovery Engine
 * 
 * Replaces keyword-based discovery with true AI-powered semantic search.
 * Uses a single Copilot CLI call that autonomously explores the codebase
 * to find all documentation, source code, tests, and recent commits
 * related to a feature.
 */

import * as vscode from 'vscode';
import { exec, ChildProcess } from 'child_process';
import { escapeShellArg, getAIModelSetting, getWorkingDirectory } from '../ai-service/copilot-cli-invoker';
import { AIProcessManager } from '../ai-service/ai-process-manager';
import {
    DiscoveryRequest,
    DiscoveryProcess,
    DiscoveryResult,
    DiscoveryPhase,
    DiscoveryEvent,
    DiscoveryEventType,
    DiscoverySourceType,
    DiscoveryCommitInfo
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
 * Build the discovery prompt for the AI
 */
function buildDiscoveryPrompt(
    featureDescription: string,
    config: AIDiscoveryConfig
): string {
    const focusAreasSection = config.focusAreas && config.focusAreas.length > 0
        ? `\n## Priority Areas\nFocus on these directories first: ${config.focusAreas.join(', ')}`
        : '';

    const excludeSection = config.excludePatterns && config.excludePatterns.length > 0
        ? `\n## Excluded Patterns\nSkip files matching: ${config.excludePatterns.join(', ')}`
        : '';

    return `You are a code exploration agent. Find all files and commits related to a feature.

## Feature to find
${featureDescription}
${focusAreasSection}
${excludeSection}

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
- For files: include "path" field (relative to repository root)`;
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
 * Uses Copilot CLI to semantically search the codebase
 */
export class AIDiscoveryEngine implements vscode.Disposable {
    private readonly _onDidChangeProcess = new vscode.EventEmitter<DiscoveryEvent>();
    readonly onDidChangeProcess = this._onDidChangeProcess.event;

    private processes: Map<string, DiscoveryProcess> = new Map();
    private runningProcesses: Map<string, ChildProcess> = new Map();
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
     * Start a new AI-powered discovery process
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

            // Build the prompt
            const prompt = buildDiscoveryPrompt(request.featureDescription, {
                ...config,
                focusAreas: config.focusAreas,
                excludePatterns: request.scope.excludePatterns
            });

            // Phase 2: AI is exploring the codebase
            await this.updatePhase(process, 'scanning-files', 10);

            // Invoke Copilot CLI
            const result = await this.invokeCopilotCLI(
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
            console.error('AI Discovery error:', err);

            process.status = 'failed';
            process.error = err.message;
            process.endTime = new Date();

            this.emitEvent('process-failed', process);

            return process;
        } finally {
            // Clean up running process reference
            this.runningProcesses.delete(process.id);
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
        return new Promise((resolve) => {
            const escapedPrompt = escapeShellArg(prompt);
            const model = getAIModelSetting();
            const cwd = getWorkingDirectory(workspaceRoot);

            let command = `copilot --allow-all-tools -p ${escapedPrompt}`;
            if (model) {
                command = `copilot --allow-all-tools --model ${model} -p ${escapedPrompt}`;
            }

            const childProcess = exec(command, {
                cwd,
                timeout: timeoutSeconds * 1000,
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            }, (error, stdout, stderr) => {
                if (error) {
                    if (error.killed) {
                        resolve({
                            success: false,
                            error: `AI discovery timed out after ${timeoutSeconds} seconds`
                        });
                        return;
                    }

                    if (error.message.includes('command not found') ||
                        error.message.includes('not recognized')) {
                        resolve({
                            success: false,
                            error: 'Copilot CLI is not installed. Please install it with: npm install -g @anthropic-ai/claude-code'
                        });
                        return;
                    }

                    resolve({
                        success: false,
                        error: `Copilot CLI error: ${error.message}`
                    });
                    return;
                }

                // Parse the output to extract just the response
                const response = this.parseCopilotOutput(stdout);

                if (!response) {
                    resolve({
                        success: false,
                        error: 'No response received from Copilot CLI'
                    });
                    return;
                }

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
     * Cancel a running discovery process
     */
    cancelProcess(processId: string): void {
        const process = this.processes.get(processId);
        if (process && process.status === 'running') {
            // Kill the child process if running
            const childProcess = this.runningProcesses.get(processId);
            if (childProcess) {
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
            startTime: new Date()
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
        // Cancel all running processes
        for (const [id, childProcess] of this.runningProcesses.entries()) {
            childProcess.kill();
        }
        this.runningProcesses.clear();
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
        repositoryRoot
    };
}

