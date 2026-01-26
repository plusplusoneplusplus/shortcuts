# Pipeline Core Package - Developer Reference

This is a pure Node.js package (`@anthropic-ai/pipeline-core`) that provides the AI pipeline execution engine. It has no VS Code dependencies and can be used in CLI tools, tests, and other Node.js environments.

## Package Structure

```
packages/pipeline-core/
├── src/
│   ├── index.ts              # Main public API
│   ├── logger.ts             # Pluggable logger abstraction
│   ├── ai/                   # AI service components
│   │   ├── index.ts          # AI module exports
│   │   ├── types.ts          # AI types (backends, models, results)
│   │   ├── session-pool.ts   # Reusable Copilot SDK session pool
│   │   ├── cli-utils.ts      # Shell escaping, temp file handling
│   │   └── copilot-sdk-service.ts  # Copilot SDK wrapper
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
│       └── ai-response-parser.ts  # JSON extraction
├── test/                     # Vitest tests
│   ├── map-reduce/
│   │   ├── concurrency-limiter.test.ts
│   │   └── temp-file-utils.test.ts
│   └── pipeline/
│       └── csv-reader.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Key Modules

### Logger

Pluggable logger abstraction that allows different environments to provide their own logging implementation.

```typescript
import { setLogger, getLogger, consoleLogger, nullLogger, LogCategory } from '@anthropic-ai/pipeline-core';

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

### AI Service

Copilot SDK integration with session pooling and CLI utilities.

```typescript
import { 
    CopilotSDKService, 
    getCopilotSDKService,
    approveAllPermissions,
    escapeShellArg,
    buildCliCommand 
} from '@anthropic-ai/pipeline-core';

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
```

### Map-Reduce Framework

Parallel AI processing with splitters, mappers, and reducers.

```typescript
import { 
    createExecutor,
    createFileSplitter,
    createDeterministicReducer,
    createCodeReviewJob
} from '@anthropic-ai/pipeline-core';

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
} from '@anthropic-ai/pipeline-core';

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

Safe file operations, HTTP requests, text matching.

```typescript
import {
    safeReadFile,
    safeWriteFile,
    glob,
    httpGet,
    calculateSimilarity,
    extractJSON
} from '@anthropic-ai/pipeline-core';

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
```

## Testing

Tests use Vitest and are located in `test/`.

```bash
# Run all tests
npm run test:run

# Run tests in watch mode
npm test

# Run specific test file
npx vitest run test/map-reduce/concurrency-limiter.test.ts
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
    setLogger 
} from '@anthropic-ai/pipeline-core';

// Set up VS Code logger
setLogger({
    debug: (cat, msg) => getExtensionLogger().debug(cat, msg),
    info: (cat, msg) => getExtensionLogger().info(cat, msg),
    warn: (cat, msg) => getExtensionLogger().warn(cat, msg),
    error: (cat, msg, err) => getExtensionLogger().error(cat, msg, err),
});
```

## Cross-Platform Compatibility

All code is designed to work on Linux, macOS, and Windows:
- Path handling uses `path.join()` and `path.resolve()`
- Shell escaping handles platform differences
- Line endings are normalized
- Temp files use `os.tmpdir()`

## See Also

- `docs/designs/pipeline-core-extraction.md` - Design document for package extraction
- `src/shortcuts/ai-service/AGENTS.md` - VS Code AI service integration
- `src/shortcuts/map-reduce/AGENTS.md` - VS Code map-reduce integration
- `src/shortcuts/yaml-pipeline/AGENTS.md` - VS Code pipeline UI
