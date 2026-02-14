# Pipeline Core Package - Developer Reference

This is a pure Node.js package (`pipeline-core`) that provides the AI pipeline execution engine. It has no VS Code dependencies and can be used in CLI tools, tests, and other Node.js environments.

## Package Structure

```
packages/pipeline-core/
├── src/
│   ├── index.ts              # Main public API
│   ├── logger.ts             # Pluggable logger abstraction
│   ├── errors/               # Error handling
│   │   ├── index.ts          # Error module exports
│   │   ├── error-codes.ts    # ErrorCode enum, mapSystemErrorCode()
│   │   └── pipeline-core-error.ts  # PipelineCoreError base class
│   ├── config/               # Configuration defaults
│   │   ├── index.ts          # Config module exports
│   │   └── defaults.ts       # Centralized default constants
│   ├── runtime/              # Runtime policies
│   │   ├── index.ts          # Runtime module exports
│   │   ├── cancellation.ts   # CancellationError, createCancellationToken
│   │   ├── timeout.ts        # TimeoutError, withTimeout
│   │   ├── retry.ts          # RetryExhaustedError, withRetry, backoff strategies
│   │   └── policy.ts         # Unified policy runner (runWithPolicy)
│   ├── queue/                # Task queue system
│   │   ├── index.ts          # Queue module exports
│   │   ├── types.ts          # TaskType, TaskPriority, QueueStatus, payload types
│   │   ├── task-queue-manager.ts  # TaskQueueManager (priority-based queue)
│   │   └── queue-executor.ts     # QueueExecutor (executes tasks with concurrency)
│   ├── ai/                   # AI service components
│   │   ├── index.ts          # AI module exports
│   │   ├── types.ts          # AI types (backends, models, results)
│   │   ├── session-pool.ts   # Reusable Copilot SDK session pool
│   │   ├── cli-utils.ts      # Shell escaping, temp file handling
│   │   ├── copilot-sdk-service.ts  # Copilot SDK wrapper
│   │   ├── model-registry.ts      # Central AI model registry (6 models)
│   │   ├── mcp-config-loader.ts   # MCP server config loader
│   │   ├── command-types.ts       # AI command type definitions
│   │   ├── process-types.ts       # AI process tracking types
│   │   ├── prompt-builder.ts      # Pure prompt template variable substitution
│   │   ├── program-utils.ts       # Program existence checking
│   │   └── timeouts.ts            # Re-exports default AI timeout
│   ├── process-store.ts      # ProcessStore interface — abstract storage for AI processes
│   ├── file-process-store.ts # FileProcessStore — JSON file-based persistence
│   ├── map-reduce/           # Map-reduce framework
│   │   ├── index.ts          # Map-reduce exports
│   │   ├── types.ts          # Core types (WorkItem, MapResult, etc.)
│   │   ├── executor.ts       # MapReduceExecutor
│   │   ├── concurrency-limiter.ts  # Parallel execution control
│   │   ├── prompt-template.ts      # Template rendering
│   │   ├── temp-file-utils.ts      # Temp file management
│   │   ├── reducers/         # Reducer implementations
│   │   ├── splitters/        # Splitter implementations
│   │   └── jobs/             # Pre-built job factories
│   ├── pipeline/             # YAML pipeline execution
│   │   ├── index.ts          # Pipeline exports
│   │   ├── types.ts          # Pipeline config types
│   │   ├── executor.ts       # Pipeline executor
│   │   ├── csv-reader.ts     # CSV parsing
│   │   ├── template.ts       # Template engine
│   │   ├── filter-executor.ts    # Rule/AI/hybrid filters
│   │   ├── prompt-resolver.ts    # Prompt file resolution
│   │   ├── skill-resolver.ts     # Skill loading
│   │   └── input-generator.ts    # AI input generation
│   └── utils/                # Shared utilities
│       ├── index.ts          # Utils exports
│       ├── file-utils.ts     # Safe file I/O
│       ├── glob-utils.ts     # File pattern matching
│       ├── exec-utils.ts     # Shell execution
│       ├── http-utils.ts     # HTTP requests
│       ├── text-matching.ts  # Fuzzy matching
│       ├── ai-response-parser.ts  # JSON extraction
│       ├── template-engine.ts     # Template variable substitution engine
│       ├── terminal-types.ts      # Terminal type definitions
│       ├── window-focus-service.ts  # Window focus service
│       ├── external-terminal-launcher.ts  # External terminal launcher
│       └── process-monitor.ts     # Process monitoring utilities
├── test/                     # Vitest tests (29 test files)
│   ├── ai/                   # AI tests
│   │   ├── mcp-config-loader.test.ts
│   │   └── model-registry.test.ts
│   ├── errors/               # Error handling tests
│   │   └── pipeline-core-error.test.ts
│   ├── process-store.test.ts        # ProcessStore interface tests
│   ├── file-process-store.test.ts   # FileProcessStore persistence tests
│   ├── map-reduce/           # Map-reduce tests
│   │   ├── concurrency-limiter.test.ts
│   │   ├── executor.test.ts
│   │   ├── prompt-template.test.ts
│   │   ├── reduce-process-tracking.test.ts
│   │   ├── reducers.test.ts
│   │   ├── splitters.test.ts
│   │   └── temp-file-utils.test.ts
│   ├── pipeline/             # Pipeline tests
│   │   ├── ai-reduce.test.ts
│   │   ├── batch-mapping.test.ts
│   │   ├── csv-reader.test.ts
│   │   ├── edge-cases.test.ts
│   │   ├── executor.test.ts
│   │   ├── index.test.ts
│   │   ├── input-generator.test.ts
│   │   ├── multi-model-fanout.test.ts
│   │   ├── results-file.test.ts
│   │   ├── skill-resolver.test.ts
│   │   ├── template.test.ts
│   │   └── text-mode.test.ts
│   ├── queue/                # Queue tests
│   │   ├── queue-executor.test.ts
│   │   └── task-queue-manager.test.ts
│   ├── runtime/              # Runtime policy tests
│   │   └── policy.test.ts
│   └── utils/                # Utils tests
│       ├── ai-response-parser.test.ts
│       └── template-engine.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Key Modules

### Logger

Pluggable logger abstraction that allows different environments to provide their own logging implementation.

```typescript
import { setLogger, getLogger, consoleLogger, nullLogger, LogCategory } from 'pipeline-core';

// Use default console logger
const logger = getLogger();
logger.info(LogCategory.AI, 'Processing started');

// Set custom logger (e.g., VS Code OutputChannel)
setLogger({
    debug: (cat, msg) => outputChannel.appendLine(`[DEBUG] [${cat}] ${msg}`),
    info: (cat, msg) => outputChannel.appendLine(`[INFO] [${cat}] ${msg}`),
    warn: (cat, msg) => outputChannel.appendLine(`[WARN] [${cat}] ${msg}`),
    error: (cat, msg, err) => outputChannel.appendLine(`[ERROR] [${cat}] ${msg} ${err || ''}`),
});

// Disable logging (for tests)
setLogger(nullLogger);
```

### Error Handling

Structured error handling with error codes, metadata, and error chaining.

```typescript
import { 
    PipelineCoreError, 
    ErrorCode, 
    toPipelineCoreError,
    wrapError,
    isPipelineCoreError 
} from 'pipeline-core';

// Create a structured error
throw new PipelineCoreError('Failed to parse CSV', {
    code: ErrorCode.CSV_PARSE_ERROR,
    cause: originalError,
    meta: { filePath: 'input.csv', line: 42, phase: 'input' }
});

// Convert any error to PipelineCoreError
try {
    await riskyOperation();
} catch (error) {
    const pipelineError = toPipelineCoreError(error, ErrorCode.UNKNOWN, {
        executionId: 'exec-123',
        phase: 'map'
    });
    throw pipelineError;
}

// Wrap error with context
try {
    await processItem(item);
} catch (error) {
    throw wrapError(
        `Failed to process item ${item.id}`,
        error,
        ErrorCode.PROCESSING_ERROR,
        { itemIndex: 0, totalItems: 10 }
    );
}

// Check error type
if (isPipelineCoreError(error)) {
    console.log(`Error code: ${error.code}`);
    console.log(`Metadata:`, error.meta);
    console.log(`Detailed:`, error.toDetailedString());
}
```

### Runtime Policies

Unified policy system for timeout, retry, and cancellation.

```typescript
import { 
    runWithPolicy, 
    withTimeout, 
    withRetry,
    createPolicyRunner,
    TimeoutError,
    RetryExhaustedError 
} from 'pipeline-core';

// Simple timeout
const result = await withTimeout(
    () => fetchData(),
    { timeoutMs: 5000, operationName: 'fetchData' }
);

// Retry with exponential backoff
const result = await withRetry(
    () => apiCall(),
    {
        attempts: 3,
        delayMs: 1000,
        backoff: 'exponential',
        maxDelayMs: 30000,
        operationName: 'apiCall'
    }
);

// Unified policy (timeout + retry + cancellation)
const cancellationToken = createCancellationToken();
const result = await runWithPolicy(
    () => processData(),
    {
        timeoutMs: 10000,
        retryOnFailure: true,
        retryAttempts: 3,
        retryDelayMs: 1000,
        backoff: 'exponential',
        isCancelled: cancellationToken.isCancelled,
        operationName: 'processData',
        meta: { executionId: 'exec-123' }
    }
);

// Create a reusable policy runner
const aiPolicy = createPolicyRunner({
    timeoutMs: 30000,
    retryOnFailure: true,
    retryAttempts: 2,
    operationName: 'AI Invocation'
});

// Use the policy runner
const result = await aiPolicy(() => invokeAI(prompt));
```

### Task Queue

Priority-based task queue with concurrency control.

```typescript
import { 
    TaskQueueManager, 
    QueueExecutor,
    TaskType,
    TaskPriority 
} from 'pipeline-core';

// Create queue manager
const queueManager = new TaskQueueManager({
    maxQueueSize: 100,
    maxHistorySize: 1000
});

// Enqueue tasks with priorities
const taskId1 = queueManager.enqueue({
    type: TaskType.AI_REQUEST,
    priority: TaskPriority.HIGH,
    payload: { prompt: 'Analyze code', model: 'claude-sonnet-4.5' }
});

const taskId2 = queueManager.enqueue({
    type: TaskType.AI_REQUEST,
    priority: TaskPriority.LOW,
    payload: { prompt: 'Generate summary', model: 'claude-haiku-4.5' }
});

// Create executor
const executor = new QueueExecutor(
    queueManager,
    async (task) => {
        // Execute the task
        if (task.type === TaskType.AI_REQUEST) {
            return await processAIRequest(task.payload);
        }
        throw new Error(`Unknown task type: ${task.type}`);
    },
    {
        maxConcurrency: 3,
        autoStart: true
    }
);

// Listen to events
executor.on('taskStarted', (task) => {
    console.log(`Task ${task.id} started`);
});

executor.on('taskCompleted', (task, result) => {
    console.log(`Task ${task.id} completed:`, result);
});

executor.on('taskFailed', (task, error) => {
    console.error(`Task ${task.id} failed:`, error);
});

// Control execution
executor.start();  // Start processing
executor.stop();   // Stop processing (running tasks complete)
executor.cancelTask(taskId1);  // Cancel specific task
```

### Config Defaults

Centralized default constants for consistent configuration across the package.

```typescript
import {
    DEFAULT_AI_TIMEOUT_MS,
    DEFAULT_PARALLEL_LIMIT,
    DEFAULT_MAX_CONCURRENCY,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_RETRY_ATTEMPTS,
    DEFAULT_QUEUE_MAX_CONCURRENT
} from 'pipeline-core';

// Use defaults in configuration
const executor = createExecutor({
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    timeoutMs: DEFAULT_AI_TIMEOUT_MS
});

const queueExecutor = new QueueExecutor(queueManager, taskExecutor, {
    maxConcurrency: DEFAULT_QUEUE_MAX_CONCURRENT
});
```

### AI Service

Copilot SDK integration with session pooling and CLI utilities.

```typescript
import { 
    CopilotSDKService, 
    getCopilotSDKService,
    approveAllPermissions,
    escapeShellArg,
    buildCliCommand,
    getModelLabel,
    isValidModel
} from 'pipeline-core';

// Get singleton service
const service = getCopilotSDKService();

// Check availability
if (await service.isAvailable()) {
    // Send message with SDK
    const result = await service.sendMessage({
        prompt: 'Analyze this code',
        workingDirectory: '/path/to/project',
        timeoutMs: 60000,
        onPermissionRequest: approveAllPermissions  // ⚠️ Use cautiously
    });
    
    if (result.success) {
        console.log(result.response);
    }
}

// Build CLI command with proper escaping
const { command, deliveryMethod } = buildCliCommand('copilot', {
    prompt: 'Hello world',
    model: 'gpt-4'
});

// Model registry utilities
if (isValidModel('claude-sonnet-4.5')) {
    const label = getModelLabel('claude-sonnet-4.5');
    console.log(`Using model: ${label}`);
}
```

### Map-Reduce Framework

Parallel AI processing with splitters, mappers, and reducers.

```typescript
import { 
    createExecutor,
    createFileSplitter,
    createDeterministicReducer,
    createCodeReviewJob
} from 'pipeline-core';

// Create executor
const executor = createExecutor({
    maxConcurrency: 5,
    timeoutMs: 60000,
    onProgress: (progress) => console.log(`${progress.percentage}%`)
});

// Execute a job
const result = await executor.execute(myJob, inputData);
```

### Pipeline Execution

YAML-based pipeline configuration and execution.

```typescript
import { 
    executePipeline,
    parsePipelineYAML,
    readCSVFile,
    substituteTemplate
} from 'pipeline-core';

// Parse pipeline config
const config = await parsePipelineYAML(yamlContent);

// Execute pipeline
const result = await executePipeline(config, {
    aiInvoker: myAIInvoker,
    pipelineDirectory: '/path/to/pipeline',
    onProgress: (progress) => console.log(progress.message)
});
```

### Utilities

Safe file operations, HTTP requests, text matching, and more.

```typescript
import {
    safeReadFile,
    safeWriteFile,
    glob,
    httpGet,
    calculateSimilarity,
    extractJSON,
    substituteTemplateVariables
} from 'pipeline-core';

// Safe file operations
const content = await safeReadFile('/path/to/file.txt');
await safeWriteFile('/path/to/output.txt', 'content');

// Glob pattern matching
const files = glob('**/*.ts', '/project');

// HTTP requests
const response = await httpGet('https://api.example.com/data');

// Text similarity
const similarity = calculateSimilarity('hello', 'hallo');

// Extract JSON from AI response
const json = extractJSON('Some text {"result": true} more text');

// Template variable substitution
const result = substituteTemplateVariables(
    'Hello {{name}}, you have {{count}} items',
    { name: 'Alice', count: 5 }
);
// Result: 'Hello Alice, you have 5 items'
```

### Process Store

Abstract storage for AI process tracking, designed for multi-workspace server scenarios.

```typescript
import {
    ProcessStore,
    FileProcessStore,
    WorkspaceInfo,
    ProcessFilter,
    ProcessOutputEvent
} from 'pipeline-core';

// FileProcessStore — JSON file persistence at configurable directory
const store = new FileProcessStore({ dataDir: '~/.pipeline-server' });
await store.initialize();

// Register a workspace
const workspace: WorkspaceInfo = {
    id: 'a1b2c3d4e5f6a7b8',  // SHA-256 of workspace root (first 16 hex)
    name: 'my-project',
    rootPath: '/path/to/project',
    color: '#4fc3f7'
};
await store.registerWorkspace(workspace);

// Add/update processes
await store.addProcess(workspace.id, process);
await store.updateProcess(processId, { status: 'completed', endTime: Date.now() });

// Query with filters
const filter: ProcessFilter = { workspaceId: workspace.id, status: 'running', limit: 50 };
const processes = await store.getAllProcesses(filter);

// Stream output events
store.onProcessOutput(processId, (event: ProcessOutputEvent) => {
    console.log(event.chunk);
});

// Cleanup
await store.clearProcesses('completed');
```

**Key behaviors:**
- Atomic writes via temp file + rename pattern
- Sequential write queue prevents corruption
- Max 500 processes retained; pruning preserves non-terminal processes
- In-memory EventEmitter per process for streaming support

## Testing

Tests use Vitest and are located in `test/`. There are 29 test files covering all modules.

```bash
# Run all tests
npm run test:run

# Run tests in watch mode
npm test

# Run specific test file
npx vitest run test/map-reduce/concurrency-limiter.test.ts

# Run tests for a specific module
npx vitest run test/queue/
```

## Building

```bash
# Build TypeScript
npm run build

# Type check only
npx tsc --noEmit
```

## Integration with VS Code Extension

The VS Code extension imports from this package:

```typescript
// In extension code
import { 
    executePipeline,
    CopilotSDKService,
    setLogger,
    PipelineCoreError,
    ErrorCode,
    runWithPolicy
} from 'pipeline-core';

// Set up VS Code logger
setLogger({
    debug: (cat, msg) => getExtensionLogger().debug(cat, msg),
    info: (cat, msg) => getExtensionLogger().info(cat, msg),
    warn: (cat, msg) => getExtensionLogger().warn(cat, msg),
    error: (cat, msg, err) => getExtensionLogger().error(cat, msg, err),
});

// Use structured error handling
try {
    await executePipeline(config, options);
} catch (error) {
    if (isPipelineCoreError(error)) {
        vscode.window.showErrorMessage(
            `Pipeline failed: ${error.message} (${error.code})`
        );
    }
}
```

## Cross-Platform Compatibility

All code is designed to work on Linux, macOS, and Windows:
- Path handling uses `path.join()` and `path.resolve()`
- Shell escaping handles platform differences
- Line endings are normalized
- Temp files use `os.tmpdir()`
- EventEmitter-based queue system (no platform-specific APIs)

## See Also

- `docs/designs/pipeline-core-extraction.md` - Design document for package extraction
- `src/shortcuts/ai-service/AGENTS.md` - VS Code AI service integration
- `src/shortcuts/map-reduce/AGENTS.md` - VS Code map-reduce integration
- `src/shortcuts/yaml-pipeline/AGENTS.md` - VS Code pipeline UI
