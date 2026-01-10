/**
 * AIProcessManager - Tracks running AI processes with persistence
 *
 * Generic process manager for tracking AI CLI invocations.
 * Provides events for process lifecycle and methods for managing processes.
 * Persists completed processes to VSCode's Memento storage for review.
 */

import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from './ai-service-logger';
import { 
    AIProcess, 
    AIProcessStatus, 
    AIProcessType,
    CodeReviewGroupMetadata, 
    CompleteGroupOptions,
    deserializeProcess, 
    DiscoveryProcessMetadata, 
    GenericGroupMetadata, 
    GenericProcessMetadata, 
    ProcessEvent, 
    ProcessGroupOptions, 
    SerializedAIProcess, 
    serializeProcess,
    TypedProcessOptions 
} from './types';

/**
 * Storage key for persisted processes
 */
const STORAGE_KEY = 'aiProcesses.history';

/**
 * Maximum number of processes to persist
 */
const MAX_PERSISTED_PROCESSES = 100;

/**
 * Directory name for storing process results
 */
const RESULTS_DIR_NAME = 'ai-processes';
const RAW_STDOUT_DIR_NAME = 'shortcuts-ai-processes';

/**
 * Internal process tracking with child process reference
 */
interface TrackedProcess extends AIProcess {
    childProcess?: ChildProcess;
}

/**
 * Manages AI process tracking with persistence
 */
export class AIProcessManager implements vscode.Disposable {
    private processes: Map<string, TrackedProcess> = new Map();
    private processCounter = 0;
    private context?: vscode.ExtensionContext;
    private initialized = false;

    private readonly _onDidChangeProcesses = new vscode.EventEmitter<ProcessEvent>();
    readonly onDidChangeProcesses: vscode.Event<ProcessEvent> = this._onDidChangeProcesses.event;

    /**
     * Initialize the process manager with extension context for persistence
     * @param context VSCode extension context for Memento storage
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        await this.loadFromStorage();
        this.initialized = true;
    }

    /**
     * Check if the manager is initialized with persistence
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Load persisted processes from storage
     */
    private async loadFromStorage(): Promise<void> {
        if (!this.context) {
            return;
        }

        try {
            const serialized = this.context.globalState.get<SerializedAIProcess[]>(STORAGE_KEY, []);

            // Convert serialized processes back to AIProcess objects
            for (const s of serialized) {
                const process = deserializeProcess(s);
                // Only load completed processes (not running ones - they're stale)
                if (process.status !== 'running') {
                    this.processes.set(process.id, process);
                    // Update counter to avoid ID collisions
                    const idMatch = process.id.match(/^process-(\d+)-/);
                    if (idMatch) {
                        const num = parseInt(idMatch[1], 10);
                        if (num >= this.processCounter) {
                            this.processCounter = num + 1;
                        }
                    }
                }
            }

            if (serialized.length > 0) {
                this._onDidChangeProcesses.fire({ type: 'processes-cleared' }); // Trigger refresh
            }
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.AI, 'Failed to load AI processes from storage', error instanceof Error ? error : new Error(String(error)));
        }
    }

    /**
     * Save processes to storage
     */
    private async saveToStorage(): Promise<void> {
        if (!this.context) {
            return;
        }

        try {
            // Get all non-running processes (running processes shouldn't be persisted)
            const toSave = Array.from(this.processes.values())
                .filter(p => p.status !== 'running')
                .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
                .slice(0, MAX_PERSISTED_PROCESSES)
                .map(p => serializeProcess({
                    id: p.id,
                    type: p.type,
                    promptPreview: p.promptPreview,
                    fullPrompt: p.fullPrompt,
                    status: p.status,
                    startTime: p.startTime,
                    endTime: p.endTime,
                    error: p.error,
                    result: p.result,
                    resultFilePath: p.resultFilePath,
                    rawStdoutFilePath: p.rawStdoutFilePath,
                    metadata: p.metadata,
                    groupMetadata: p.groupMetadata,
                    codeReviewMetadata: p.codeReviewMetadata,
                    discoveryMetadata: p.discoveryMetadata,
                    codeReviewGroupMetadata: p.codeReviewGroupMetadata,
                    structuredResult: p.structuredResult,
                    parentProcessId: p.parentProcessId
                }));

            await this.context.globalState.update(STORAGE_KEY, toSave);
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.AI, 'Failed to save AI processes to storage', error instanceof Error ? error : new Error(String(error)));
        }
    }

    /**
     * Register a new process
     * @param prompt The full prompt being sent
     * @param childProcess Optional child process reference for cancellation
     * @returns The process ID
     */
    registerProcess(prompt: string, childProcess?: ChildProcess): string {
        const id = `process-${++this.processCounter}-${Date.now()}`;
        const promptPreview = this.createPromptPreview(prompt);

        const process: TrackedProcess = {
            id,
            type: 'clarification',
            promptPreview,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            childProcess
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        return id;
    }

    // ========================================================================
    // Generic API Methods - Preferred for new feature integrations
    // ========================================================================

    /**
     * Register a typed process with generic metadata.
     * This is the preferred API for new features to register processes.
     * 
     * @param prompt The full prompt being sent
     * @param options Options including type, metadata, and parent process ID
     * @param childProcess Optional child process reference for cancellation
     * @returns The process ID
     */
    registerTypedProcess(
        prompt: string,
        options: TypedProcessOptions,
        childProcess?: ChildProcess
    ): string {
        const prefix = options.idPrefix || options.type.replace(/[^a-z0-9]/gi, '-');
        const id = `${prefix}-${++this.processCounter}-${Date.now()}`;
        const promptPreview = this.createPromptPreview(prompt);

        const process: TrackedProcess = {
            id,
            type: options.type,
            promptPreview,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            childProcess,
            metadata: options.metadata,
            parentProcessId: options.parentProcessId
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        // If this is a child process, update the parent's child list
        if (options.parentProcessId) {
            this.addChildToParent(options.parentProcessId, id);
        }

        return id;
    }

    /**
     * Register a process group with generic metadata.
     * This is the preferred API for features that run parallel processes.
     * 
     * @param prompt Description or prompt for the group
     * @param options Options including type and metadata
     * @returns The group process ID
     */
    registerProcessGroup(
        prompt: string,
        options: ProcessGroupOptions
    ): string {
        const prefix = options.idPrefix || `${options.type.replace(/[^a-z0-9]/gi, '-')}-group`;
        const id = `${prefix}-${++this.processCounter}-${Date.now()}`;
        const promptPreview = this.createPromptPreview(prompt);

        const groupMetadata: GenericGroupMetadata = {
            ...(options.metadata || {}),
            type: options.type,
            childProcessIds: []
        };

        const process: TrackedProcess = {
            id,
            type: options.type,
            promptPreview,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            groupMetadata
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        return id;
    }

    /**
     * Complete a process group with results.
     * This is the generic API for completing grouped processes.
     * 
     * @param id Group process ID
     * @param options Completion options including result and stats
     */
    completeProcessGroup(id: string, options: CompleteGroupOptions): void {
        const process = this.processes.get(id);
        if (!process || !process.groupMetadata) {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = options.result;
        process.structuredResult = options.structuredResult;

        // Store execution stats in group metadata if provided
        if (options.executionStats) {
            (process.groupMetadata as Record<string, unknown>).executionStats = options.executionStats;
        }

        // Save result to file
        const filePath = this.saveResultToFile(process);
        if (filePath) {
            process.resultFilePath = filePath;
        }

        this._onDidChangeProcesses.fire({ type: 'process-updated', process });
        this.saveToStorage();
    }

    /**
     * Add a child process ID to a parent group
     * @param parentId Parent process ID
     * @param childId Child process ID
     */
    private addChildToParent(parentId: string, childId: string): void {
        const parent = this.processes.get(parentId);
        if (!parent) {
            return;
        }

        // Try generic group metadata first
        if (parent.groupMetadata) {
            parent.groupMetadata.childProcessIds.push(childId);
            return;
        }

        // Fall back to legacy code review group metadata
        if (parent.codeReviewGroupMetadata) {
            parent.codeReviewGroupMetadata.childProcessIds.push(childId);
        }
    }

    /**
     * Get child process IDs from a parent process
     * Works with both generic and legacy group metadata
     * @param parentId Parent process ID
     * @returns Array of child process IDs
     */
    getChildProcessIds(parentId: string): string[] {
        const parent = this.processes.get(parentId);
        if (!parent) {
            return [];
        }

        // Try generic group metadata first
        if (parent.groupMetadata) {
            return parent.groupMetadata.childProcessIds;
        }

        // Fall back to legacy code review group metadata
        if (parent.codeReviewGroupMetadata) {
            return parent.codeReviewGroupMetadata.childProcessIds;
        }

        return [];
    }

    // ========================================================================
    // Legacy API Methods - Kept for backward compatibility
    // New features should use the generic API above
    // ========================================================================

    /**
     * @deprecated Use registerTypedProcess with type='code-review' instead.
     * Register a new code review process
     * @param prompt The full prompt being sent
     * @param metadata Code review metadata
     * @param childProcess Optional child process reference for cancellation
     * @param parentProcessId Optional parent process ID for grouped reviews
     * @returns The process ID
     */
    registerCodeReviewProcess(
        prompt: string,
        metadata: {
            reviewType: 'commit' | 'pending' | 'staged';
            commitSha?: string;
            commitMessage?: string;
            rulesUsed: string[];
            diffStats?: { files: number; additions: number; deletions: number };
        },
        childProcess?: ChildProcess,
        parentProcessId?: string
    ): string {
        const id = `review-${++this.processCounter}-${Date.now()}`;

        // Create a more descriptive preview for code reviews
        let promptPreview: string;
        if (metadata.rulesUsed.length === 1) {
            // Single rule - show rule name
            promptPreview = metadata.rulesUsed[0];
        } else if (metadata.reviewType === 'commit' && metadata.commitSha) {
            promptPreview = `Review: ${metadata.commitSha.substring(0, 7)}`;
        } else if (metadata.reviewType === 'pending') {
            promptPreview = 'Review: pending changes';
        } else {
            promptPreview = 'Review: staged changes';
        }

        const process: TrackedProcess = {
            id,
            type: 'code-review',
            promptPreview,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            childProcess,
            codeReviewMetadata: metadata,
            parentProcessId
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        // If this is a child process, update the parent's child list
        if (parentProcessId) {
            const parent = this.processes.get(parentProcessId);
            if (parent && parent.codeReviewGroupMetadata) {
                parent.codeReviewGroupMetadata.childProcessIds.push(id);
            }
        }

        return id;
    }

    /**
     * @deprecated Use registerProcessGroup with type='code-review-group' instead.
     * Register a new code review group (master process for parallel reviews)
     * @param metadata Group metadata including review type and rules
     * @returns The group process ID
     */
    registerCodeReviewGroup(
        metadata: Omit<CodeReviewGroupMetadata, 'childProcessIds' | 'executionStats'>
    ): string {
        const id = `review-group-${++this.processCounter}-${Date.now()}`;

        // Create a descriptive preview for the group
        let promptPreview: string;
        if (metadata.reviewType === 'commit' && metadata.commitSha) {
            promptPreview = `Review: ${metadata.commitSha.substring(0, 7)} (${metadata.rulesUsed.length} rules)`;
        } else if (metadata.reviewType === 'pending') {
            promptPreview = `Review: pending (${metadata.rulesUsed.length} rules)`;
        } else {
            promptPreview = `Review: staged (${metadata.rulesUsed.length} rules)`;
        }

        const groupMetadata: CodeReviewGroupMetadata = {
            ...metadata,
            childProcessIds: []
        };

        const process: TrackedProcess = {
            id,
            type: 'code-review-group',
            promptPreview,
            fullPrompt: `Code review group with ${metadata.rulesUsed.length} rules: ${metadata.rulesUsed.join(', ')}`,
            status: 'running',
            startTime: new Date(),
            codeReviewGroupMetadata: groupMetadata
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        return id;
    }

    /**
     * @deprecated Use completeProcessGroup instead.
     * Complete a code review group with aggregated results
     * @param id Group process ID
     * @param result Aggregated result summary
     * @param structuredResult Serialized aggregated result
     * @param executionStats Execution statistics
     */
    completeCodeReviewGroup(
        id: string,
        result: string,
        structuredResult: string,
        executionStats: CodeReviewGroupMetadata['executionStats']
    ): void {
        const process = this.processes.get(id);
        if (!process || process.type !== 'code-review-group') {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = result;
        process.structuredResult = structuredResult;

        if (process.codeReviewGroupMetadata) {
            process.codeReviewGroupMetadata.executionStats = executionStats;
        }

        // Save result to file
        const filePath = this.saveResultToFile(process);
        if (filePath) {
            process.resultFilePath = filePath;
        }

        this._onDidChangeProcesses.fire({ type: 'process-updated', process });
        this.saveToStorage();
    }

    /**
     * Update the structured result for a process
     * This is a generic method to update the structured result after completion
     * @param id Process ID
     * @param structuredResult Serialized structured result (JSON string)
     */
    updateProcessStructuredResult(id: string, structuredResult: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.structuredResult = structuredResult;

        // Update the result file with the new structured result
        const filePath = this.saveResultToFile(process);
        if (filePath) {
            process.resultFilePath = filePath;
        }

        this._onDidChangeProcesses.fire({ type: 'process-updated', process });
        this.saveToStorage();
    }

    /**
     * Get child processes for a group.
     * Supports both generic group metadata and legacy code review group metadata.
     * @param groupId The group process ID
     * @returns Array of child processes
     */
    getChildProcesses(groupId: string): AIProcess[] {
        const childIds = this.getChildProcessIds(groupId);
        return childIds
            .map(id => this.getProcess(id))
            .filter((p): p is AIProcess => p !== undefined);
    }

    /**
     * Check if a process is a child of a group
     * @param processId Process ID to check
     * @returns True if the process has a parent
     */
    isChildProcess(processId: string): boolean {
        const process = this.processes.get(processId);
        return !!process?.parentProcessId;
    }

    /**
     * Get all top-level processes (processes without parents)
     * @returns Array of top-level processes
     */
    getTopLevelProcesses(): AIProcess[] {
        return this.getProcesses().filter(p => !p.parentProcessId);
    }

    /**
     * Register a new discovery process
     * @param metadata Discovery process metadata
     * @returns The process ID
     */
    registerDiscoveryProcess(
        metadata: DiscoveryProcessMetadata
    ): string {
        const id = `discovery-${++this.processCounter}-${Date.now()}`;

        // Create a descriptive preview
        const preview = metadata.targetGroupPath
            ? `Discover: ${metadata.featureDescription.substring(0, 30)}... (${metadata.targetGroupPath})`
            : `Discover: ${metadata.featureDescription.substring(0, 40)}...`;

        const process: TrackedProcess = {
            id,
            type: 'discovery',
            promptPreview: preview.length > 50 ? preview.substring(0, 47) + '...' : preview,
            fullPrompt: `Feature: ${metadata.featureDescription}\nKeywords: ${metadata.keywords?.join(', ') || 'auto-extracted'}`,
            status: 'running',
            startTime: new Date(),
            discoveryMetadata: metadata
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        return id;
    }

    /**
     * Attach a child process to an existing tracked process.
     */
    attachChildProcess(id: string, childProcess: ChildProcess): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.childProcess = childProcess;
    }

    /**
     * Save raw stdout to a temp file and attach it to the process.
     */
    attachRawStdout(id: string, stdout: string): string | undefined {
        const process = this.processes.get(id);
        if (!process || stdout.length === 0) {
            return undefined;
        }

        const filePath = this.saveRawStdoutToFile(process, stdout);
        if (!filePath) {
            return undefined;
        }

        process.rawStdoutFilePath = filePath;
        this._onDidChangeProcesses.fire({ type: 'process-updated', process });

        if (process.status !== 'running') {
            this.saveToStorage();
        }

        return filePath;
    }

    /**
     * Complete a discovery process with results
     * @param id Process ID
     * @param resultCount Number of items found
     * @param resultSummary Summary of results
     * @param serializedResults Optional serialized discovery results (JSON string)
     */
    completeDiscoveryProcess(id: string, resultCount: number, resultSummary?: string, serializedResults?: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = resultSummary || `Found ${resultCount} related items`;

        // Store serialized discovery results for later viewing
        if (serializedResults) {
            process.structuredResult = serializedResults;
        }

        // Update metadata with result count
        if (process.discoveryMetadata) {
            process.discoveryMetadata.resultCount = resultCount;
        }

        process.childProcess = undefined;

        // Save result to file
        const filePath = this.saveResultToFile(process);
        if (filePath) {
            process.resultFilePath = filePath;
        }

        this._onDidChangeProcesses.fire({ type: 'process-updated', process });
        this.saveToStorage();
    }

    /**
     * Complete a code review process with structured result
     * @param id Process ID
     * @param result Raw AI response
     * @param structuredResult Parsed structured result as JSON string
     */
    completeCodeReviewProcess(id: string, result: string, structuredResult: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = result;
        process.structuredResult = structuredResult;
        process.childProcess = undefined;

        // Save result to file
        const filePath = this.saveResultToFile(process);
        if (filePath) {
            process.resultFilePath = filePath;
        }

        this._onDidChangeProcesses.fire({ type: 'process-updated', process });
        this.saveToStorage();
    }

    /**
     * Update process status
     */
    updateProcess(id: string, status: AIProcessStatus, result?: string, error?: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.status = status;
        process.endTime = new Date();

        if (result) {
            process.result = result;
        }
        if (error) {
            process.error = error;
        }

        // Clear child process reference
        process.childProcess = undefined;

        // Save result to file when process completes with a result
        if (status !== 'running' && process.result) {
            const filePath = this.saveResultToFile(process);
            if (filePath) {
                process.resultFilePath = filePath;
            }
        }

        this._onDidChangeProcesses.fire({ type: 'process-updated', process });

        // Persist changes when a process completes
        if (status !== 'running') {
            this.saveToStorage();
        }
    }

    /**
     * Mark a process as completed
     */
    completeProcess(id: string, result?: string): void {
        this.updateProcess(id, 'completed', result);
    }

    /**
     * Mark a process as failed
     */
    failProcess(id: string, error: string): void {
        this.updateProcess(id, 'failed', undefined, error);
    }

    /**
     * Cancel a running process
     */
    cancelProcess(id: string): boolean {
        const process = this.processes.get(id);
        if (!process || process.status !== 'running') {
            return false;
        }

        // Kill the child process if available
        if (process.childProcess) {
            process.childProcess.kill();
        }

        this.updateProcess(id, 'cancelled', undefined, 'Cancelled by user');
        return true;
    }

    /**
     * Remove a process from tracking
     */
    removeProcess(id: string): void {
        const process = this.processes.get(id);
        if (process) {
            this.processes.delete(id);
            this._onDidChangeProcesses.fire({ type: 'process-removed', process });
            // Persist the removal
            this.saveToStorage();
        }
    }

    /**
     * Clear all completed, failed, and cancelled processes
     */
    clearCompletedProcesses(): void {
        const toRemove: string[] = [];

        for (const [id, process] of this.processes) {
            if (process.status !== 'running') {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            this.processes.delete(id);
        }

        if (toRemove.length > 0) {
            this._onDidChangeProcesses.fire({ type: 'processes-cleared' });
            // Persist the clearing
            this.saveToStorage();
        }
    }

    /**
     * Clear all processes (including running ones - used for cleanup)
     */
    clearAllProcesses(): void {
        // Cancel running processes first
        for (const process of this.processes.values()) {
            if (process.status === 'running' && process.childProcess) {
                process.childProcess.kill();
            }
        }

        this.processes.clear();
        this._onDidChangeProcesses.fire({ type: 'processes-cleared' });
        // Clear from storage
        this.saveToStorage();
    }

    /**
     * Get all processes
     */
    getProcesses(): AIProcess[] {
        return Array.from(this.processes.values()).map(p => ({
            id: p.id,
            type: p.type,
            promptPreview: p.promptPreview,
            fullPrompt: p.fullPrompt,
            status: p.status,
            startTime: p.startTime,
            endTime: p.endTime,
            error: p.error,
            result: p.result,
            resultFilePath: p.resultFilePath,
            rawStdoutFilePath: p.rawStdoutFilePath,
            metadata: p.metadata,
            groupMetadata: p.groupMetadata,
            codeReviewMetadata: p.codeReviewMetadata,
            discoveryMetadata: p.discoveryMetadata,
            codeReviewGroupMetadata: p.codeReviewGroupMetadata,
            structuredResult: p.structuredResult,
            parentProcessId: p.parentProcessId
        }));
    }

    /**
     * Get running processes only
     */
    getRunningProcesses(): AIProcess[] {
        return this.getProcesses().filter(p => p.status === 'running');
    }

    /**
     * Get a specific process by ID
     */
    getProcess(id: string): AIProcess | undefined {
        const process = this.processes.get(id);
        if (!process) {
            return undefined;
        }
        return {
            id: process.id,
            type: process.type,
            promptPreview: process.promptPreview,
            fullPrompt: process.fullPrompt,
            status: process.status,
            startTime: process.startTime,
            endTime: process.endTime,
            error: process.error,
            result: process.result,
            resultFilePath: process.resultFilePath,
            rawStdoutFilePath: process.rawStdoutFilePath,
            metadata: process.metadata,
            groupMetadata: process.groupMetadata,
            codeReviewMetadata: process.codeReviewMetadata,
            discoveryMetadata: process.discoveryMetadata,
            codeReviewGroupMetadata: process.codeReviewGroupMetadata,
            structuredResult: process.structuredResult,
            parentProcessId: process.parentProcessId
        };
    }

    /**
     * Check if there are any running processes
     */
    hasRunningProcesses(): boolean {
        for (const process of this.processes.values()) {
            if (process.status === 'running') {
                return true;
            }
        }
        return false;
    }

    /**
     * Get count of processes by status
     */
    getProcessCounts(): { running: number; completed: number; failed: number; cancelled: number } {
        const counts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
        for (const process of this.processes.values()) {
            counts[process.status]++;
        }
        return counts;
    }

    /**
     * Create a preview of the prompt (first ~50 chars)
     */
    private createPromptPreview(prompt: string): string {
        const cleaned = prompt.replace(/\s+/g, ' ').trim();
        if (cleaned.length <= 50) {
            return cleaned;
        }
        return cleaned.substring(0, 47) + '...';
    }

    /**
     * Get the results directory path
     */
    private getResultsDir(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return path.join(workspaceFolders[0].uri.fsPath, '.vscode', RESULTS_DIR_NAME);
    }

    /**
     * Ensure the results directory exists
     */
    private ensureResultsDir(): string | undefined {
        const resultsDir = this.getResultsDir();
        if (!resultsDir) {
            return undefined;
        }

        try {
            if (!fs.existsSync(resultsDir)) {
                fs.mkdirSync(resultsDir, { recursive: true });
            }
            return resultsDir;
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.FILESYSTEM, 'Failed to create results directory', error instanceof Error ? error : new Error(String(error)), {
                resultsDir
            });
            return undefined;
        }
    }

    /**
     * Save process result to a file
     * @param process The process to save
     * @returns The file path if saved successfully, undefined otherwise
     */
    private saveResultToFile(process: TrackedProcess): string | undefined {
        if (!process.result) {
            return undefined;
        }

        const resultsDir = this.ensureResultsDir();
        if (!resultsDir) {
            return undefined;
        }

        try {
            // Create filename from process ID and timestamp
            const timestamp = process.startTime.toISOString().replace(/[:.]/g, '-');
            const filename = `${process.id}_${timestamp}.md`;
            const filePath = path.join(resultsDir, filename);

            // Build file content with metadata header
            const lines: string[] = [];
            lines.push(`# AI Process Result`);
            lines.push('');
            lines.push(`- **Process ID:** ${process.id}`);
            lines.push(`- **Type:** ${process.type}`);
            lines.push(`- **Status:** ${process.status}`);
            lines.push(`- **Started:** ${process.startTime.toISOString()}`);
            if (process.endTime) {
                lines.push(`- **Ended:** ${process.endTime.toISOString()}`);
            }
            lines.push('');
            lines.push('## Prompt');
            lines.push('');
            lines.push('```');
            lines.push(process.fullPrompt);
            lines.push('```');
            lines.push('');
            lines.push('## Response');
            lines.push('');
            lines.push(process.result);

            if (process.error) {
                lines.push('');
                lines.push('## Error');
                lines.push('');
                lines.push('```');
                lines.push(process.error);
                lines.push('```');
            }

            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            return filePath;
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.FILESYSTEM, 'Failed to save result to file', error instanceof Error ? error : new Error(String(error)), {
                processId: process.id
            });
            return undefined;
        }
    }

    /**
     * Ensure the temp directory for raw stdout exists
     */
    private ensureRawStdoutDir(): string | undefined {
        const stdoutDir = path.join(os.tmpdir(), RAW_STDOUT_DIR_NAME);
        try {
            if (!fs.existsSync(stdoutDir)) {
                fs.mkdirSync(stdoutDir, { recursive: true });
            }
            return stdoutDir;
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.FILESYSTEM, 'Failed to create raw stdout directory', error instanceof Error ? error : new Error(String(error)), {
                stdoutDir
            });
            return undefined;
        }
    }

    /**
     * Save raw stdout to a temp file
     */
    private saveRawStdoutToFile(process: TrackedProcess, stdout: string): string | undefined {
        const stdoutDir = this.ensureRawStdoutDir();
        if (!stdoutDir) {
            return undefined;
        }

        try {
            const safeId = process.id.replace(/[^a-zA-Z0-9._-]/g, '_');
            const timestamp = process.startTime.toISOString().replace(/[:.]/g, '-');
            const filename = `${safeId}_${timestamp}_stdout.txt`;
            const filePath = process.rawStdoutFilePath || path.join(stdoutDir, filename);

            fs.writeFileSync(filePath, stdout, 'utf8');
            return filePath;
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.FILESYSTEM, 'Failed to save raw stdout to file', error instanceof Error ? error : new Error(String(error)), {
                processId: process.id
            });
            return undefined;
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        // Cancel all running processes
        for (const process of this.processes.values()) {
            if (process.status === 'running' && process.childProcess) {
                process.childProcess.kill();
            }
        }
        this.processes.clear();
        this._onDidChangeProcesses.dispose();
    }
}
