# MockAIProcessManager - Testing Guide

A comprehensive mock implementation of `AIProcessManager` designed for unit testing other modules without VSCode dependencies or file system operations.

## Quick Start

```typescript
import { MockAIProcessManager } from '../../shortcuts/ai-service';

// In your test
let manager: MockAIProcessManager;

setup(() => {
    manager = new MockAIProcessManager();
});

teardown(() => {
    manager.dispose();
});

test('your test', () => {
    const id = manager.registerProcess('Test prompt');
    manager.completeProcess(id, 'Result');
    
    const process = manager.getProcess(id);
    assert.strictEqual(process.status, 'completed');
});
```

## Key Features

### ✅ No Dependencies
- **No VSCode context required** - Works standalone
- **No file system operations** - Pure in-memory
- **No async complexity** - Synchronous by default

### ✅ Full API Compatibility
Implements the complete `AIProcessManager` interface:
- All registration methods (generic and legacy)
- All lifecycle methods (complete, fail, cancel)
- All query methods (getProcess, getProcesses, etc.)
- Event emission for process changes

### ✅ Enhanced for Testing
Additional features not in the real implementation:
- **Call recording** - Inspect what methods were called
- **Manual control** - Force processes to complete/fail on demand
- **Auto-complete mode** - Processes complete automatically
- **Auto-fail mode** - Processes fail automatically
- **Async simulation** - Simulate delays for timing tests

## Usage Patterns

### Pattern 1: Basic Testing

```typescript
test('should track process registration', () => {
    const id = manager.registerProcess('Test');
    
    const process = manager.getProcess(id);
    assert.ok(process);
    assert.strictEqual(process.status, 'running');
});
```

### Pattern 2: Auto-Complete for Integration Tests

```typescript
import { createMockAIProcessManager } from '../../shortcuts/ai-service';

test('should handle auto-completing workflow', async () => {
    const manager = createMockAIProcessManager('auto-complete');
    
    const id = manager.registerProcess('Test');
    
    // Wait for auto-complete
    await new Promise(resolve => setTimeout(resolve, 20));
    
    const process = manager.getProcess(id);
    assert.strictEqual(process.status, 'completed');
    
    manager.dispose();
});
```

### Pattern 3: Using Helper Utilities

```typescript
import { 
    assertProcessCompleted,
    assertProcessCounts,
    createCodeReviewScenario
} from '../helpers/mock-ai-helpers';

test('should complete code review workflow', () => {
    const { groupId, childIds } = createCodeReviewScenario(manager);
    
    // Complete children
    childIds.forEach(id => manager.completeProcess(id));
    manager.completeProcess(groupId);
    
    // Use helpers for assertions
    assertProcessCompleted(manager, groupId);
    assertProcessCounts(manager, { completed: 4 });
});
```

### Pattern 4: Inspecting Mock Behavior

```typescript
test('should verify method calls', () => {
    manager.registerProcess('Process 1');
    manager.registerProcess('Process 2');
    
    const calls = manager.getCallsForMethod('registerProcess');
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].args[0], 'Process 1');
});
```

### Pattern 5: Testing Error Scenarios

```typescript
test('should handle failures', () => {
    const id = manager.registerProcess('Test');
    
    // Force failure
    manager.mockFailProcess(id, 'Timeout error');
    
    const process = manager.getProcess(id);
    assert.strictEqual(process.status, 'failed');
    assert.ok(process.error?.includes('Timeout'));
});
```

## Configuration Options

```typescript
const manager = new MockAIProcessManager({
    // Auto-complete processes after registration
    autoComplete: true,
    
    // Default result for auto-completed processes
    defaultResult: 'Custom result',
    
    // Simulate async behavior with delays
    simulateAsync: true,
    asyncDelay: 50, // milliseconds
    
    // Auto-fail processes instead of completing
    autoFail: false,
    defaultError: 'Custom error'
});
```

### Reconfigure After Construction

```typescript
const manager = new MockAIProcessManager();

// Later, change behavior
manager.configure({
    autoComplete: true,
    defaultResult: 'Test result'
});
```

## Helper Utilities

### Assertion Helpers

```typescript
import {
    assertProcessExists,
    assertMethodCalled,
    assertProcessCompleted,
    assertProcessFailed,
    assertProcessHasChildren,
    assertProcessHasStructuredResult,
    assertProcessCounts
} from '../helpers/mock-ai-helpers';
```

**Examples:**
```typescript
assertProcessExists(manager, processId, 'running');
assertMethodCalled(manager, 'registerProcess', 2);
assertProcessCompleted(manager, processId, 'Expected result');
assertProcessFailed(manager, processId, 'Expected error');
assertProcessHasChildren(manager, groupId, 3);
assertProcessCounts(manager, { running: 2, completed: 3 });
```

### Scenario Builders

```typescript
import {
    createManagerWithProcesses,
    createCodeReviewScenario,
    simulateCodeReviewFlow
} from '../helpers/mock-ai-helpers';
```

**Examples:**
```typescript
// Create pre-populated manager
const mgr = createManagerWithProcesses({
    running: 2,
    completed: 3,
    failed: 1
});

// Create realistic code review scenario
const { groupId, childIds } = createCodeReviewScenario(manager);

// Complete full code review workflow
const { groupId, childIds } = simulateCodeReviewFlow(manager);
```

### Async Utilities

```typescript
import {
    waitForProcessCompletion,
    waitForAllProcesses
} from '../helpers/mock-ai-helpers';
```

**Examples:**
```typescript
// Wait for specific process
await waitForProcessCompletion(manager, processId, 1000);

// Wait for all processes
await waitForAllProcesses(manager, 2000);
```

## Factory Functions

```typescript
import { createMockAIProcessManager } from '../../shortcuts/ai-service';

// Default (manual control)
const manager = createMockAIProcessManager('default');

// Auto-complete mode
const manager = createMockAIProcessManager('auto-complete');

// Auto-fail mode
const manager = createMockAIProcessManager('auto-fail');

// Async simulation
const manager = createMockAIProcessManager('async');
```

## Real-World Example

Here's a complete example of testing a code review adapter:

```typescript
class CodeReviewAdapter {
    constructor(private aiManager: MockAIProcessManager) {}
    
    async executeReview(commitSha: string, rules: string[]) {
        const groupId = this.aiManager.registerCodeReviewGroup({
            reviewType: 'commit',
            commitSha,
            rulesUsed: rules
        });
        
        for (const rule of rules) {
            const childId = this.aiManager.registerCodeReviewProcess(
                `Review: ${rule}`,
                { reviewType: 'commit', commitSha, rulesUsed: [rule] },
                undefined,
                groupId
            );
            
            // Simulate review...
            this.aiManager.completeProcess(childId, 'No issues');
        }
        
        this.aiManager.completeProcess(groupId, 'All passed');
        return groupId;
    }
}

test('should execute code review', async () => {
    const manager = new MockAIProcessManager();
    const adapter = new CodeReviewAdapter(manager);
    
    const groupId = await adapter.executeReview('abc123', ['rule1.md', 'rule2.md']);
    
    // Verify results
    assertProcessCompleted(manager, groupId);
    assertProcessHasChildren(manager, groupId, 2);
    
    const children = manager.getChildProcesses(groupId);
    assert.ok(children.every(c => c.status === 'completed'));
    
    manager.dispose();
});
```

## Comparison: Before vs After

### Before (without mock)
```typescript
// Had to create mock context
class MockGlobalState {
    private storage = new Map();
    get(key: string, defaultValue: any) { /* ... */ }
    async update(key: string, value: any) { /* ... */ }
}

class MockExtensionContext {
    globalState = new MockGlobalState();
}

test('my test', async () => {
    const manager = new AIProcessManager();
    const context = new MockExtensionContext();
    await manager.initialize(context as any); // Type casting needed
    
    // Now test...
});
```

### After (with mock)
```typescript
test('my test', () => {
    const manager = new MockAIProcessManager();
    // Ready to use immediately - no context, no initialization!
    
    const id = manager.registerProcess('Test');
    manager.completeProcess(id);
    
    manager.dispose();
});
```

## Best Practices

1. **Always dispose** - Call `manager.dispose()` in teardown
2. **Use helpers** - Leverage the helper utilities for cleaner tests
3. **Test both success and failure** - Use `mockFailProcess()` for error scenarios
4. **Inspect calls when needed** - Verify interactions with `getCallsForMethod()`
5. **Use auto-complete for integration tests** - Simulates real async behavior
6. **Keep it simple** - Use manual control for unit tests

## See Also

- `src/shortcuts/ai-service/mock-ai-process-manager.ts` - Mock implementation
- `src/test/helpers/mock-ai-helpers.ts` - Helper utilities
- `src/test/suite/mock-ai-process-manager.test.ts` - Comprehensive tests
- `src/test/suite/mock-ai-usage-example.test.ts` - Real-world examples
