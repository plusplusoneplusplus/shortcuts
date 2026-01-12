/**
 * MockAIProcessManager - Mock implementation for testing
 * 
 * Provides a lightweight, controllable mock of AIProcessManager for unit tests.
 * This allows other modules to test AI integration without real VSCode dependencies,
 * file system operations, or async complexity.
 * 
 * Key features:
 * - No VSCode context required
 * - Synchronous by default (configurable)
 * - Full inspection of registered processes
 * - Controllable process lifecycle
 * - Pre-configured test scenarios
 */

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import {
    AIProcess,
    AIProcessStatus,
    CodeReviewGroupMetadata,
    CompleteGroupOptions,
    DiscoveryProcessMetadata,
    GenericGroupMetadata,
    GenericProcessMetadata,
    IAIProcessManager,
    ProcessCounts,
    ProcessEvent,
    ProcessGroupOptions,
    TypedProcessOptions
} from './types';

/**
 * Configuration for mock behavior
 */
export interface MockAIProcessManagerConfig {
    /**
     * Whether processes should auto-complete immediately after registration
     * Default: false
     */
    autoComplete?: boolean;

    /**
     * Default result to use when auto-completing
     * Default: 'Mock result'
     */
    defaultResult?: string;

    /**
     * Whether to simulate async behavior with delays
     * Default: false (synchronous)
     */
    simulateAsync?: boolean;

    /**
     * Delay in ms when simulating async behavior
     * Default: 10
     */
    asyncDelay?: number;

    /**
     * Whether to fail processes by default
     * Default: false
     */
    autoFail?: boolean;

    /**
     * Default error message when auto-failing
     * Default: 'Mock error'
     */
    defaultError?: string;
}

/**
 * Captured call information for inspection
 */
export interface ProcessCall {
    method: string;
    processId?: string;
    args: any[];
    timestamp: Date;
}

/**
 * Mock implementation of AIProcessManager
 */
export class MockAIProcessManager implements IAIProcessManager, vscode.Disposable {
    private processes: Map<string, AIProcess> = new Map();
    private processCounter = 0;
    private calls: ProcessCall[] = [];
    private config: Required<MockAIProcessManagerConfig>;
    private eventEmitter = new EventEmitter();
    private disposed = false;

    // Event emitter compatible with vscode.Event
    readonly onDidChangeProcesses: vscode.Event<ProcessEvent>;

    constructor(config: MockAIProcessManagerConfig = {}) {
        this.config = {
            autoComplete: config.autoComplete ?? false,
            defaultResult: config.defaultResult ?? 'Mock result',
            simulateAsync: config.simulateAsync ?? false,
            asyncDelay: config.asyncDelay ?? 10,
            autoFail: config.autoFail ?? false,
            defaultError: config.defaultError ?? 'Mock error'
        };

        // Create vscode.Event compatible interface
        this.onDidChangeProcesses = (listener: (e: ProcessEvent) => any, thisArgs?: any, disposables?: vscode.Disposable[]) => {
            const wrappedListener = (event: ProcessEvent) => {
                listener.call(thisArgs, event);
            };
            this.eventEmitter.on('change', wrappedListener);

            const disposable = {
                dispose: () => {
                    this.eventEmitter.removeListener('change', wrappedListener);
                }
            };

            if (disposables) {
                disposables.push(disposable);
            }

            return disposable;
        };
    }

    // ========================================================================
    // Initialization (no-op for mock, always initialized)
    // ========================================================================

    async initialize(_context: vscode.ExtensionContext): Promise<void> {
        this.recordCall('initialize', undefined, [_context]);
        // Mock is always initialized, no storage needed
    }

    isInitialized(): boolean {
        return !this.disposed;
    }

    // ========================================================================
    // Process Registration - Generic API
    // ========================================================================

    registerTypedProcess(
        prompt: string,
        options: TypedProcessOptions,
        childProcess?: ChildProcess
    ): string {
        const prefix = options.idPrefix || options.type.replace(/[^a-z0-9]/gi, '-');
        const id = `${prefix}-${++this.processCounter}-${Date.now()}`;
        
        const process: AIProcess = {
            id,
            type: options.type,
            promptPreview: this.createPromptPreview(prompt),
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            metadata: options.metadata,
            parentProcessId: options.parentProcessId
        };

        this.processes.set(id, process);
        this.recordCall('registerTypedProcess', id, [prompt, options, childProcess]);
        this.fireEvent({ type: 'process-added', process });

        // Update parent if specified
        if (options.parentProcessId) {
            this.addChildToParent(options.parentProcessId, id);
        }

        // Auto-complete if configured
        if (this.config.autoComplete) {
            this.scheduleAutoComplete(id);
        } else if (this.config.autoFail) {
            this.scheduleAutoFail(id);
        }

        return id;
    }

    registerProcessGroup(
        prompt: string,
        options: ProcessGroupOptions
    ): string {
        const prefix = options.idPrefix || `${options.type.replace(/[^a-z0-9]/gi, '-')}-group`;
        const id = `${prefix}-${++this.processCounter}-${Date.now()}`;

        const groupMetadata: GenericGroupMetadata = {
            ...(options.metadata || {}),
            type: options.type,
            childProcessIds: []
        };

        const process: AIProcess = {
            id,
            type: options.type,
            promptPreview: this.createPromptPreview(prompt),
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            groupMetadata
        };

        this.processes.set(id, process);
        this.recordCall('registerProcessGroup', id, [prompt, options]);
        this.fireEvent({ type: 'process-added', process });

        return id;
    }

    completeProcessGroup(id: string, options: CompleteGroupOptions): void {
        const process = this.processes.get(id);
        if (!process || !process.groupMetadata) {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = options.result;
        process.structuredResult = options.structuredResult;

        if (options.executionStats) {
            (process.groupMetadata as any).executionStats = options.executionStats;
        }

        this.recordCall('completeProcessGroup', id, [id, options]);
        this.fireEvent({ type: 'process-updated', process });
    }

    // ========================================================================
    // Legacy API (for backward compatibility)
    // ========================================================================

    registerProcess(prompt: string, childProcess?: ChildProcess): string {
        const id = `process-${++this.processCounter}-${Date.now()}`;
        
        const process: AIProcess = {
            id,
            type: 'clarification',
            promptPreview: this.createPromptPreview(prompt),
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date()
        };

        this.processes.set(id, process);
        this.recordCall('registerProcess', id, [prompt, childProcess]);
        this.fireEvent({ type: 'process-added', process });

        if (this.config.autoComplete) {
            this.scheduleAutoComplete(id);
        } else if (this.config.autoFail) {
            this.scheduleAutoFail(id);
        }

        return id;
    }

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

        const process: AIProcess = {
            id,
            type: 'code-review',
            promptPreview: metadata.rulesUsed.length === 1 ? metadata.rulesUsed[0] : `Review: ${metadata.reviewType}`,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            codeReviewMetadata: metadata,
            parentProcessId
        };

        this.processes.set(id, process);
        this.recordCall('registerCodeReviewProcess', id, [prompt, metadata, childProcess, parentProcessId]);
        this.fireEvent({ type: 'process-added', process });

        if (parentProcessId) {
            this.addChildToParent(parentProcessId, id);
        }

        if (this.config.autoComplete) {
            this.scheduleAutoComplete(id);
        } else if (this.config.autoFail) {
            this.scheduleAutoFail(id);
        }

        return id;
    }

    registerCodeReviewGroup(
        metadata: Omit<CodeReviewGroupMetadata, 'childProcessIds' | 'executionStats'>
    ): string {
        const id = `review-group-${++this.processCounter}-${Date.now()}`;

        const groupMetadata: CodeReviewGroupMetadata = {
            ...metadata,
            childProcessIds: []
        };

        // Build preview that includes commit SHA for commit reviews
        let promptPreview = `Review: ${metadata.reviewType} (${metadata.rulesUsed.length} rules)`;
        if (metadata.reviewType === 'commit' && metadata.commitSha) {
            promptPreview = `Review: ${metadata.commitSha.substring(0, 7)} (${metadata.rulesUsed.length} rules)`;
        }

        const process: AIProcess = {
            id,
            type: 'code-review-group',
            promptPreview,
            fullPrompt: `Code review group with ${metadata.rulesUsed.length} rules`,
            status: 'running',
            startTime: new Date(),
            codeReviewGroupMetadata: groupMetadata
        };

        this.processes.set(id, process);
        this.recordCall('registerCodeReviewGroup', id, [metadata]);
        this.fireEvent({ type: 'process-added', process });

        return id;
    }

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

        this.recordCall('completeCodeReviewGroup', id, [id, result, structuredResult, executionStats]);
        this.fireEvent({ type: 'process-updated', process });
    }

    registerDiscoveryProcess(metadata: DiscoveryProcessMetadata): string {
        const id = `discovery-${++this.processCounter}-${Date.now()}`;

        const process: AIProcess = {
            id,
            type: 'discovery',
            promptPreview: `Discover: ${metadata.featureDescription.substring(0, 40)}...`,
            fullPrompt: `Feature: ${metadata.featureDescription}`,
            status: 'running',
            startTime: new Date(),
            discoveryMetadata: metadata
        };

        this.processes.set(id, process);
        this.recordCall('registerDiscoveryProcess', id, [metadata]);
        this.fireEvent({ type: 'process-added', process });

        if (this.config.autoComplete) {
            this.scheduleAutoComplete(id);
        } else if (this.config.autoFail) {
            this.scheduleAutoFail(id);
        }

        return id;
    }

    completeDiscoveryProcess(id: string, resultCount: number, resultSummary?: string, serializedResults?: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = resultSummary || `Found ${resultCount} related items`;
        process.structuredResult = serializedResults;

        if (process.discoveryMetadata) {
            process.discoveryMetadata.resultCount = resultCount;
        }

        this.recordCall('completeDiscoveryProcess', id, [id, resultCount, resultSummary, serializedResults]);
        this.fireEvent({ type: 'process-updated', process });
    }

    completeCodeReviewProcess(id: string, result: string, structuredResult: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = result;
        process.structuredResult = structuredResult;

        this.recordCall('completeCodeReviewProcess', id, [id, result, structuredResult]);
        this.fireEvent({ type: 'process-updated', process });
    }

    attachChildProcess(id: string, childProcess: ChildProcess): void {
        this.recordCall('attachChildProcess', id, [id, childProcess]);
        // Mock doesn't track child processes, but record the call
    }

    attachRawStdout(id: string, stdout: string): string | undefined {
        this.recordCall('attachRawStdout', id, [id, stdout]);
        // Mock doesn't save to file, but we can attach it to the process
        const process = this.processes.get(id);
        if (process) {
            process.rawStdoutFilePath = `/mock/stdout/${id}.txt`;
            return process.rawStdoutFilePath;
        }
        return undefined;
    }

    // ========================================================================
    // Process Management
    // ========================================================================

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

        this.recordCall('updateProcess', id, [id, status, result, error]);
        this.fireEvent({ type: 'process-updated', process });
    }

    completeProcess(id: string, result?: string): void {
        this.updateProcess(id, 'completed', result);
    }

    failProcess(id: string, error: string): void {
        this.updateProcess(id, 'failed', undefined, error);
    }

    cancelProcess(id: string): boolean {
        const process = this.processes.get(id);
        if (!process || process.status !== 'running') {
            return false;
        }

        // If this is a group process, cancel all child processes first
        const childIds = this.getChildProcessIds(id);
        if (childIds.length > 0) {
            for (const childId of childIds) {
                const child = this.processes.get(childId);
                if (child && child.status === 'running') {
                    this.updateProcess(childId, 'cancelled', undefined, 'Cancelled by user (parent cancelled)');
                }
            }
        }

        this.updateProcess(id, 'cancelled', undefined, 'Cancelled by user');
        this.recordCall('cancelProcess', id, [id]);
        return true;
    }

    removeProcess(id: string): void {
        const process = this.processes.get(id);
        if (process) {
            this.processes.delete(id);
            this.recordCall('removeProcess', id, [id]);
            this.fireEvent({ type: 'process-removed', process });
        }
    }

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
            this.recordCall('clearCompletedProcesses', undefined, []);
            this.fireEvent({ type: 'processes-cleared' });
        }
    }

    clearAllProcesses(): void {
        this.processes.clear();
        this.recordCall('clearAllProcesses', undefined, []);
        this.fireEvent({ type: 'processes-cleared' });
    }

    updateProcessStructuredResult(id: string, structuredResult: string): void {
        const process = this.processes.get(id);
        if (!process) {
            return;
        }

        process.structuredResult = structuredResult;
        this.recordCall('updateProcessStructuredResult', id, [id, structuredResult]);
        this.fireEvent({ type: 'process-updated', process });
    }

    // ========================================================================
    // Process Retrieval
    // ========================================================================

    getProcesses(): AIProcess[] {
        return Array.from(this.processes.values());
    }

    getRunningProcesses(): AIProcess[] {
        return this.getProcesses().filter(p => p.status === 'running');
    }

    getProcess(id: string): AIProcess | undefined {
        return this.processes.get(id);
    }

    hasRunningProcesses(): boolean {
        for (const process of this.processes.values()) {
            if (process.status === 'running') {
                return true;
            }
        }
        return false;
    }

    getProcessCounts(): ProcessCounts {
        const counts: ProcessCounts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
        for (const process of this.processes.values()) {
            counts[process.status]++;
        }
        return counts;
    }

    getChildProcessIds(parentId: string): string[] {
        const parent = this.processes.get(parentId);
        if (!parent) {
            return [];
        }

        if (parent.groupMetadata) {
            return parent.groupMetadata.childProcessIds;
        }

        if (parent.codeReviewGroupMetadata) {
            return parent.codeReviewGroupMetadata.childProcessIds;
        }

        return [];
    }

    getChildProcesses(groupId: string): AIProcess[] {
        const childIds = this.getChildProcessIds(groupId);
        return childIds
            .map(id => this.getProcess(id))
            .filter((p): p is AIProcess => p !== undefined);
    }

    isChildProcess(processId: string): boolean {
        const process = this.processes.get(processId);
        return !!process?.parentProcessId;
    }

    getTopLevelProcesses(): AIProcess[] {
        return this.getProcesses().filter(p => !p.parentProcessId);
    }

    // ========================================================================
    // Mock-Specific Utilities
    // ========================================================================

    /**
     * Get all recorded method calls for inspection
     */
    getCalls(): ProcessCall[] {
        return [...this.calls];
    }

    /**
     * Get calls for a specific method
     */
    getCallsForMethod(method: string): ProcessCall[] {
        return this.calls.filter(c => c.method === method);
    }

    /**
     * Get calls for a specific process
     */
    getCallsForProcess(processId: string): ProcessCall[] {
        return this.calls.filter(c => c.processId === processId);
    }

    /**
     * Clear all recorded calls
     */
    clearCalls(): void {
        this.calls = [];
    }

    /**
     * Reset the mock to initial state
     */
    reset(): void {
        this.processes.clear();
        this.calls = [];
        this.processCounter = 0;
    }

    /**
     * Configure mock behavior after construction
     */
    configure(config: Partial<MockAIProcessManagerConfig>): void {
        Object.assign(this.config, config);
    }

    /**
     * Manually complete a process (useful for testing)
     */
    mockCompleteProcess(id: string, result: string = this.config.defaultResult, structuredResult?: string): void {
        const process = this.processes.get(id);
        if (!process) {
            throw new Error(`Process ${id} not found`);
        }

        process.status = 'completed';
        process.endTime = new Date();
        process.result = result;
        if (structuredResult) {
            process.structuredResult = structuredResult;
        }

        this.fireEvent({ type: 'process-updated', process });
    }

    /**
     * Manually fail a process (useful for testing)
     */
    mockFailProcess(id: string, error: string = this.config.defaultError): void {
        const process = this.processes.get(id);
        if (!process) {
            throw new Error(`Process ${id} not found`);
        }

        process.status = 'failed';
        process.endTime = new Date();
        process.error = error;

        this.fireEvent({ type: 'process-updated', process });
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    dispose(): void {
        this.processes.clear();
        this.calls = [];
        this.eventEmitter.removeAllListeners();
        this.disposed = true;
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private createPromptPreview(prompt: string): string {
        const cleaned = prompt.replace(/\s+/g, ' ').trim();
        if (cleaned.length <= 50) {
            return cleaned;
        }
        return cleaned.substring(0, 47) + '...';
    }

    private addChildToParent(parentId: string, childId: string): void {
        const parent = this.processes.get(parentId);
        if (!parent) {
            return;
        }

        if (parent.groupMetadata) {
            parent.groupMetadata.childProcessIds.push(childId);
        } else if (parent.codeReviewGroupMetadata) {
            parent.codeReviewGroupMetadata.childProcessIds.push(childId);
        }
    }

    private recordCall(method: string, processId: string | undefined, args: any[]): void {
        this.calls.push({
            method,
            processId,
            args,
            timestamp: new Date()
        });
    }

    private fireEvent(event: ProcessEvent): void {
        this.eventEmitter.emit('change', event);
    }

    private scheduleAutoComplete(id: string): void {
        if (this.config.simulateAsync) {
            setTimeout(() => {
                this.mockCompleteProcess(id);
            }, this.config.asyncDelay);
        } else {
            // Complete synchronously in next tick
            setImmediate(() => {
                this.mockCompleteProcess(id);
            });
        }
    }

    private scheduleAutoFail(id: string): void {
        if (this.config.simulateAsync) {
            setTimeout(() => {
                this.mockFailProcess(id);
            }, this.config.asyncDelay);
        } else {
            setImmediate(() => {
                this.mockFailProcess(id);
            });
        }
    }
}

/**
 * Helper factory function for common test scenarios
 */
export function createMockAIProcessManager(scenario?: 'default' | 'auto-complete' | 'auto-fail' | 'async'): MockAIProcessManager {
    switch (scenario) {
        case 'auto-complete':
            return new MockAIProcessManager({ autoComplete: true });
        case 'auto-fail':
            return new MockAIProcessManager({ autoFail: true });
        case 'async':
            return new MockAIProcessManager({ simulateAsync: true, asyncDelay: 50 });
        case 'default':
        default:
            return new MockAIProcessManager();
    }
}
