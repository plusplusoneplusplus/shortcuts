/**
 * Test Helper Utilities for MockAIProcessManager
 * 
 * Provides common patterns and utilities for testing with the mock AI service.
 */

import * as assert from 'assert';
import { AIProcess, AIProcessStatus } from '../../shortcuts/ai-service/types';
import { MockAIProcessManager } from '../../shortcuts/ai-service/mock-ai-process-manager';

/**
 * Assert that a process exists and has the expected status
 */
export function assertProcessExists(
    manager: MockAIProcessManager,
    processId: string,
    expectedStatus?: AIProcessStatus
): AIProcess {
    const process = manager.getProcess(processId);
    assert.ok(process, `Process ${processId} should exist`);
    
    if (expectedStatus) {
        assert.strictEqual(
            process.status,
            expectedStatus,
            `Process ${processId} should have status ${expectedStatus}, but has ${process.status}`
        );
    }
    
    return process;
}

/**
 * Assert that a method was called on the mock manager
 */
export function assertMethodCalled(
    manager: MockAIProcessManager,
    method: string,
    times?: number
): void {
    const calls = manager.getCallsForMethod(method);
    
    if (times !== undefined) {
        assert.strictEqual(
            calls.length,
            times,
            `Expected ${method} to be called ${times} times, but was called ${calls.length} times`
        );
    } else {
        assert.ok(
            calls.length > 0,
            `Expected ${method} to be called at least once, but was never called`
        );
    }
}

/**
 * Assert that a method was NOT called
 */
export function assertMethodNotCalled(
    manager: MockAIProcessManager,
    method: string
): void {
    const calls = manager.getCallsForMethod(method);
    assert.strictEqual(
        calls.length,
        0,
        `Expected ${method} to not be called, but was called ${calls.length} times`
    );
}

/**
 * Assert that a process has children
 */
export function assertProcessHasChildren(
    manager: MockAIProcessManager,
    parentId: string,
    expectedCount?: number
): string[] {
    const childIds = manager.getChildProcessIds(parentId);
    
    if (expectedCount !== undefined) {
        assert.strictEqual(
            childIds.length,
            expectedCount,
            `Expected parent ${parentId} to have ${expectedCount} children, but has ${childIds.length}`
        );
    } else {
        assert.ok(
            childIds.length > 0,
            `Expected parent ${parentId} to have children, but has none`
        );
    }
    
    return childIds;
}

/**
 * Assert that a process is completed with expected result
 */
export function assertProcessCompleted(
    manager: MockAIProcessManager,
    processId: string,
    expectedResult?: string
): AIProcess {
    const process = assertProcessExists(manager, processId, 'completed');
    
    if (expectedResult !== undefined) {
        assert.strictEqual(
            process.result,
            expectedResult,
            `Expected process result to be "${expectedResult}", but was "${process.result}"`
        );
    }
    
    return process;
}

/**
 * Assert that a process failed with expected error
 */
export function assertProcessFailed(
    manager: MockAIProcessManager,
    processId: string,
    expectedError?: string
): AIProcess {
    const process = assertProcessExists(manager, processId, 'failed');
    
    if (expectedError !== undefined) {
        assert.ok(
            process.error?.includes(expectedError),
            `Expected process error to contain "${expectedError}", but was "${process.error}"`
        );
    }
    
    return process;
}

/**
 * Assert that a process has structured result
 */
export function assertProcessHasStructuredResult(
    manager: MockAIProcessManager,
    processId: string
): any {
    const process = assertProcessExists(manager, processId);
    
    assert.ok(
        process.structuredResult,
        `Expected process ${processId} to have structured result, but it doesn't`
    );
    
    // Try to parse as JSON
    try {
        return JSON.parse(process.structuredResult);
    } catch (error) {
        assert.fail(`Structured result is not valid JSON: ${process.structuredResult}`);
    }
}

/**
 * Wait for a process to complete (useful with async simulation)
 */
export async function waitForProcessCompletion(
    manager: MockAIProcessManager,
    processId: string,
    timeout: number = 1000
): Promise<AIProcess> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const process = manager.getProcess(processId);
        
        if (!process) {
            throw new Error(`Process ${processId} not found`);
        }
        
        if (process.status !== 'running') {
            return process;
        }
        
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error(`Process ${processId} did not complete within ${timeout}ms`);
}

/**
 * Wait for all running processes to complete
 */
export async function waitForAllProcesses(
    manager: MockAIProcessManager,
    timeout: number = 1000
): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        if (!manager.hasRunningProcesses()) {
            return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Final check after timeout - processes may have completed during the last iteration
    if (!manager.hasRunningProcesses()) {
        return;
    }
    
    const running = manager.getRunningProcesses();
    throw new Error(
        `${running.length} processes still running after ${timeout}ms: ${running.map(p => p.id).join(', ')}`
    );
}

/**
 * Create a mock manager with pre-registered processes for testing
 */
export function createManagerWithProcesses(config: {
    completed?: number;
    running?: number;
    failed?: number;
    cancelled?: number;
}): MockAIProcessManager {
    const manager = new MockAIProcessManager();
    
    // Register completed processes
    for (let i = 0; i < (config.completed || 0); i++) {
        const id = manager.registerProcess(`Completed process ${i + 1}`);
        manager.completeProcess(id, `Result ${i + 1}`);
    }
    
    // Register running processes
    for (let i = 0; i < (config.running || 0); i++) {
        manager.registerProcess(`Running process ${i + 1}`);
    }
    
    // Register failed processes
    for (let i = 0; i < (config.failed || 0); i++) {
        const id = manager.registerProcess(`Failed process ${i + 1}`);
        manager.failProcess(id, `Error ${i + 1}`);
    }
    
    // Register cancelled processes
    for (let i = 0; i < (config.cancelled || 0); i++) {
        const id = manager.registerProcess(`Cancelled process ${i + 1}`);
        manager.cancelProcess(id);
    }
    
    return manager;
}

/**
 * Assert process counts match expected
 */
export function assertProcessCounts(
    manager: MockAIProcessManager,
    expected: {
        running?: number;
        completed?: number;
        failed?: number;
        cancelled?: number;
    }
): void {
    const actual = manager.getProcessCounts();
    
    if (expected.running !== undefined) {
        assert.strictEqual(
            actual.running,
            expected.running,
            `Expected ${expected.running} running processes, but found ${actual.running}`
        );
    }
    
    if (expected.completed !== undefined) {
        assert.strictEqual(
            actual.completed,
            expected.completed,
            `Expected ${expected.completed} completed processes, but found ${actual.completed}`
        );
    }
    
    if (expected.failed !== undefined) {
        assert.strictEqual(
            actual.failed,
            expected.failed,
            `Expected ${expected.failed} failed processes, but found ${actual.failed}`
        );
    }
    
    if (expected.cancelled !== undefined) {
        assert.strictEqual(
            actual.cancelled,
            expected.cancelled,
            `Expected ${expected.cancelled} cancelled processes, but found ${actual.cancelled}`
        );
    }
}

/**
 * Create a typical code review test scenario
 */
export function createCodeReviewScenario(manager: MockAIProcessManager): {
    groupId: string;
    childIds: string[];
} {
    const groupId = manager.registerCodeReviewGroup({
        reviewType: 'commit',
        commitSha: 'abc123',
        commitMessage: 'Test commit',
        rulesUsed: ['rule1.md', 'rule2.md', 'rule3.md']
    });
    
    const childIds = [
        manager.registerCodeReviewProcess(
            'Review with rule1.md',
            {
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            },
            undefined,
            groupId
        ),
        manager.registerCodeReviewProcess(
            'Review with rule2.md',
            {
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule2.md']
            },
            undefined,
            groupId
        ),
        manager.registerCodeReviewProcess(
            'Review with rule3.md',
            {
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule3.md']
            },
            undefined,
            groupId
        )
    ];
    
    return { groupId, childIds };
}

/**
 * Simulate a complete code review flow
 */
export function simulateCodeReviewFlow(
    manager: MockAIProcessManager,
    shouldFail: boolean = false
): { groupId: string; childIds: string[] } {
    const { groupId, childIds } = createCodeReviewScenario(manager);
    
    // Complete or fail child processes
    childIds.forEach((childId, index) => {
        if (shouldFail && index === 1) {
            manager.failProcess(childId, 'Review failed');
        } else {
            const result = JSON.stringify({
                findings: [],
                assessment: 'pass',
                rule: `rule${index + 1}.md`
            });
            manager.completeCodeReviewProcess(childId, 'No issues found', result);
        }
    });
    
    // Complete group
    manager.completeCodeReviewGroup(
        groupId,
        shouldFail ? 'Review completed with errors' : 'All rules passed',
        JSON.stringify({
            totalRules: childIds.length,
            passedRules: shouldFail ? childIds.length - 1 : childIds.length,
            failedRules: shouldFail ? 1 : 0
        }),
        {
            totalRules: childIds.length,
            successfulRules: shouldFail ? childIds.length - 1 : childIds.length,
            failedRules: shouldFail ? 1 : 0,
            totalTimeMs: 1000
        }
    );
    
    return { groupId, childIds };
}
