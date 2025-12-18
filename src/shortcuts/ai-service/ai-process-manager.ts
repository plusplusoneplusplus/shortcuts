/**
 * AIProcessManager - Tracks running AI processes
 * 
 * Generic process manager for tracking AI CLI invocations.
 * Provides events for process lifecycle and methods for managing processes.
 */

import { ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { AIProcess, AIProcessStatus, ProcessEvent, ProcessEventType } from './types';

/**
 * Internal process tracking with child process reference
 */
interface TrackedProcess extends AIProcess {
    childProcess?: ChildProcess;
}

/**
 * Manages AI process tracking
 */
export class AIProcessManager implements vscode.Disposable {
    private processes: Map<string, TrackedProcess> = new Map();
    private processCounter = 0;

    private readonly _onDidChangeProcesses = new vscode.EventEmitter<ProcessEvent>();
    readonly onDidChangeProcesses: vscode.Event<ProcessEvent> = this._onDidChangeProcesses.event;

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
        }
    }

    /**
     * Get all processes
     */
    getProcesses(): AIProcess[] {
        return Array.from(this.processes.values()).map(p => ({
            id: p.id,
            promptPreview: p.promptPreview,
            fullPrompt: p.fullPrompt,
            status: p.status,
            startTime: p.startTime,
            endTime: p.endTime,
            error: p.error,
            result: p.result
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
            promptPreview: process.promptPreview,
            fullPrompt: process.fullPrompt,
            status: process.status,
            startTime: process.startTime,
            endTime: process.endTime,
            error: process.error,
            result: process.result
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

