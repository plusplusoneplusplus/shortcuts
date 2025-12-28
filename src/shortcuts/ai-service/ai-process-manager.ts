/**
 * AIProcessManager - Tracks running AI processes with persistence
 * 
 * Generic process manager for tracking AI CLI invocations.
 * Provides events for process lifecycle and methods for managing processes.
 * Persists completed processes to VSCode's Memento storage for review.
 */

import { ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { AIProcess, AIProcessStatus, deserializeProcess, ProcessEvent, ProcessEventType, serializeProcess, SerializedAIProcess } from './types';

/**
 * Storage key for persisted processes
 */
const STORAGE_KEY = 'aiProcesses.history';

/**
 * Maximum number of processes to persist
 */
const MAX_PERSISTED_PROCESSES = 100;

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
            console.error('Failed to load AI processes from storage:', error);
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
                    codeReviewMetadata: p.codeReviewMetadata,
                    structuredResult: p.structuredResult
                }));

            await this.context.globalState.update(STORAGE_KEY, toSave);
        } catch (error) {
            console.error('Failed to save AI processes to storage:', error);
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

    /**
     * Register a new code review process
     * @param prompt The full prompt being sent
     * @param metadata Code review metadata
     * @param childProcess Optional child process reference for cancellation
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
        childProcess?: ChildProcess
    ): string {
        const id = `review-${++this.processCounter}-${Date.now()}`;
        
        // Create a more descriptive preview for code reviews
        let promptPreview: string;
        if (metadata.reviewType === 'commit' && metadata.commitSha) {
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
            codeReviewMetadata: metadata
        };

        this.processes.set(id, process);
        this._onDidChangeProcesses.fire({ type: 'process-added', process });

        return id;
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
            codeReviewMetadata: p.codeReviewMetadata,
            structuredResult: p.structuredResult
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
            codeReviewMetadata: process.codeReviewMetadata,
            structuredResult: process.structuredResult
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

