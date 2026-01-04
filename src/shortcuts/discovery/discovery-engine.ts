/**
 * Discovery Engine for Auto AI Discovery
 * 
 * This module provides both AI-powered and keyword-based discovery:
 * - AIDiscoveryEngine: Uses Copilot CLI for semantic search (recommended)
 * - DiscoveryEngine: Legacy keyword-based search (fallback)
 * 
 * The DiscoveryEngine now delegates to AIDiscoveryEngine by default,
 * with fallback to keyword-based search if AI is unavailable.
 */

import * as vscode from 'vscode';
import {
    DiscoveryRequest,
    DiscoveryProcess,
    DiscoveryResult,
    DiscoveryPhase,
    DiscoveryEvent,
    DiscoveryEventType,
    RawSearchResult,
    DEFAULT_DISCOVERY_SCOPE,
    DEFAULT_SCORING_CONFIG
} from './types';
import { extractKeywords, combineKeywords } from './keyword-extractor';
import { FileSearchProvider, GitSearchProvider } from './search-providers';
import { scoreResults, deduplicateResults } from './relevance-scorer';
import { AIDiscoveryEngine, createAIDiscoveryRequest } from './ai-discovery-engine';

/**
 * Discovery mode setting
 */
export type DiscoveryMode = 'ai' | 'keyword' | 'auto';

/**
 * Options for DiscoveryEngine constructor
 */
export interface DiscoveryEngineOptions {
    /** Force a specific discovery mode (useful for testing) */
    forceMode?: DiscoveryMode;
}

/**
 * Discovery Engine class
 * Manages the discovery process and emits events for progress updates.
 * 
 * By default, uses AI-powered discovery via AIDiscoveryEngine.
 * Falls back to keyword-based search if AI is unavailable or disabled.
 */
export class DiscoveryEngine implements vscode.Disposable {
    private readonly _onDidChangeProcess = new vscode.EventEmitter<DiscoveryEvent>();
    readonly onDidChangeProcess = this._onDidChangeProcess.event;
    
    private processes: Map<string, DiscoveryProcess> = new Map();
    private fileSearchProvider: FileSearchProvider;
    private gitSearchProvider: GitSearchProvider;
    private aiEngine: AIDiscoveryEngine;
    private disposables: vscode.Disposable[] = [];
    private forcedMode?: DiscoveryMode;
    
    constructor(options?: DiscoveryEngineOptions) {
        this.fileSearchProvider = new FileSearchProvider();
        this.gitSearchProvider = new GitSearchProvider();
        this.aiEngine = new AIDiscoveryEngine();
        this.forcedMode = options?.forceMode;
        
        // Forward AI engine events
        this.disposables.push(
            this.aiEngine.onDidChangeProcess(event => {
                // Store process in our map for unified tracking
                this.processes.set(event.process.id, event.process);
                this._onDidChangeProcess.fire(event);
            })
        );
    }

    /**
     * Get the discovery mode from settings or forced mode
     */
    private getDiscoveryMode(): DiscoveryMode {
        // If mode is forced (e.g., for testing), use that
        if (this.forcedMode) {
            return this.forcedMode;
        }
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.discovery');
        return config.get<DiscoveryMode>('mode', 'ai');
    }

    /**
     * Check if AI discovery is enabled
     */
    private isAIDiscoveryEnabled(): boolean {
        const mode = this.getDiscoveryMode();
        return mode === 'ai' || mode === 'auto';
    }
    
    /**
     * Start a new discovery process
     * Uses AI-powered discovery by default, with keyword fallback
     */
    async discover(request: DiscoveryRequest): Promise<DiscoveryProcess> {
        const mode = this.getDiscoveryMode();

        // Use AI discovery if enabled
        if (mode === 'ai' || mode === 'auto') {
            try {
                console.log('Discovery: Using AI-powered discovery');
                return await this.aiEngine.discover(request);
            } catch (error) {
                if (mode === 'ai') {
                    // AI mode is required, don't fall back
                    const process = this.createProcess(request);
                    process.status = 'failed';
                    process.error = `AI discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    process.endTime = new Date();
                    this.processes.set(process.id, process);
                    this.emitEvent('process-failed', process);
                    return process;
                }
                // Auto mode: fall back to keyword search
                console.log('Discovery: AI discovery failed, falling back to keyword search');
            }
        }

        // Keyword-based discovery (legacy or fallback)
        return this.discoverWithKeywords(request);
    }

    /**
     * Legacy keyword-based discovery
     */
    private async discoverWithKeywords(request: DiscoveryRequest): Promise<DiscoveryProcess> {
        // Create new process
        const process = this.createProcess(request);
        this.processes.set(process.id, process);
        this.emitEvent('process-started', process);
        
        try {
            // Phase 1: Extract keywords
            await this.updatePhase(process, 'extracting-keywords', 5);
            const extractionResult = extractKeywords(request.featureDescription);
            const keywords = combineKeywords(
                extractionResult.keywords,
                request.keywords
            );
            
            if (keywords.length === 0) {
                throw new Error('No keywords could be extracted from the feature description');
            }
            
            console.log(`Discovery: Extracted ${keywords.length} keywords:`, keywords);
            
            // Phase 2: Search files
            await this.updatePhase(process, 'scanning-files', 10);
            const fileResults = await this.searchFiles(
                keywords,
                request,
                (progress) => this.updateProgress(process, 10 + progress * 0.3)
            );
            console.log(`Discovery: Found ${fileResults.length} file matches`);
            
            // Phase 3: Search git history
            await this.updatePhase(process, 'scanning-git', 40);
            const gitResults = await this.searchGit(
                keywords,
                request,
                (progress) => this.updateProgress(process, 40 + progress * 0.2)
            );
            console.log(`Discovery: Found ${gitResults.length} commit matches`);
            
            // Phase 4: Score and rank results
            await this.updatePhase(process, 'scoring-relevance', 60);
            const allResults = [...fileResults, ...gitResults];
            const scoredResults = await scoreResults(
                allResults,
                keywords,
                request.featureDescription,
                DEFAULT_SCORING_CONFIG
            );
            
            // Deduplicate
            const uniqueResults = deduplicateResults(scoredResults);
            console.log(`Discovery: ${uniqueResults.length} unique results after scoring`);
            
            // Phase 5: Complete
            await this.updatePhase(process, 'completed', 100);
            process.status = 'completed';
            process.results = uniqueResults;
            process.endTime = new Date();
            
            this.emitEvent('process-completed', process);
            
            return process;
            
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Discovery error:', err);
            
            process.status = 'failed';
            process.error = err.message;
            process.endTime = new Date();
            
            this.emitEvent('process-failed', process);
            
            return process;
        }
    }
    
    /**
     * Cancel a running discovery process
     */
    cancelProcess(processId: string): void {
        // Try AI engine first
        this.aiEngine.cancelProcess(processId);

        // Also check local processes
        const process = this.processes.get(processId);
        if (process && process.status === 'running') {
            process.status = 'cancelled';
            process.endTime = new Date();
            this.emitEvent('process-cancelled', process);
        }
    }
    
    /**
     * Get a process by ID
     */
    getProcess(processId: string): DiscoveryProcess | undefined {
        return this.processes.get(processId) || this.aiEngine.getProcess(processId);
    }
    
    /**
     * Get all processes
     */
    getAllProcesses(): DiscoveryProcess[] {
        // Combine processes from both engines, avoiding duplicates
        const allProcesses = new Map<string, DiscoveryProcess>();
        
        for (const process of this.processes.values()) {
            allProcesses.set(process.id, process);
        }
        
        for (const process of this.aiEngine.getAllProcesses()) {
            allProcesses.set(process.id, process);
        }
        
        return Array.from(allProcesses.values());
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
        this.aiEngine.clearCompletedProcesses();
    }
    
    /**
     * Create a new discovery process
     */
    private createProcess(request: DiscoveryRequest): DiscoveryProcess {
        return {
            id: `discovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
     * Update process progress
     */
    private updateProgress(process: DiscoveryProcess, progress: number): void {
        if (process.status === 'running') {
            process.progress = Math.round(progress);
            this.emitEvent('process-updated', process);
        }
    }
    
    /**
     * Search files for matches
     */
    private async searchFiles(
        keywords: string[],
        request: DiscoveryRequest,
        onProgress: (progress: number) => void
    ): Promise<RawSearchResult[]> {
        onProgress(0);
        
        const results = await this.fileSearchProvider.search(
            keywords,
            request.scope,
            request.repositoryRoot
        );
        
        onProgress(1);
        return results;
    }
    
    /**
     * Search git history for matches
     */
    private async searchGit(
        keywords: string[],
        request: DiscoveryRequest,
        onProgress: (progress: number) => void
    ): Promise<RawSearchResult[]> {
        onProgress(0);
        
        // Check if it's a git repository
        if (!GitSearchProvider.isGitRepository(request.repositoryRoot)) {
            console.log('Discovery: Not a git repository, skipping git search');
            onProgress(1);
            return [];
        }
        
        const results = await this.gitSearchProvider.search(
            keywords,
            request.scope,
            request.repositoryRoot
        );
        
        onProgress(1);
        return results;
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
        this._onDidChangeProcess.dispose();
        this.aiEngine.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

/**
 * Create a default discovery request
 */
export function createDiscoveryRequest(
    featureDescription: string,
    repositoryRoot: string,
    options?: {
        keywords?: string[];
        targetGroupPath?: string;
        scope?: Partial<typeof DEFAULT_DISCOVERY_SCOPE>;
    }
): DiscoveryRequest {
    return {
        featureDescription,
        keywords: options?.keywords,
        scope: {
            ...DEFAULT_DISCOVERY_SCOPE,
            ...options?.scope
        },
        targetGroupPath: options?.targetGroupPath,
        repositoryRoot
    };
}

