# Migration Plan: Copilot CLI to Copilot SDK

## Overview

Replace the current child-process-based Copilot CLI invocation with the `@github/copilot-sdk` for better session management, reliability, and streaming support.

**Current State**: `invokeCopilotCLI()` spawns `copilot` CLI via `exec()`, parses stdout manually
**Target State**: `CopilotSDKService` using structured JSON-RPC communication with session persistence

## Key Benefits

1. **Session persistence** - conversations survive across requests, can resume
2. **No stdout parsing** - structured JSON-RPC responses
3. **Built-in process management** - auto-restart on crash
4. **Better cancellation** - `session.abort()` vs killing process
5. **Streaming support** - event-based real-time responses
6. **Tool support** - can define custom tools for the AI

## Architecture

### New Files
```
src/shortcuts/ai-service/
├── copilot-sdk-service.ts      # New: SDK wrapper (singleton client, session pool)
├── session-pool.ts             # New: Manages reusable sessions
├── copilot-cli-invoker.ts      # Existing: Keep as fallback
└── types.ts                    # Update: Add SDK types
```

### CopilotSDKService Design
```typescript
class CopilotSDKService {
    private client: CopilotClient | null = null;
    private sessionPool: SessionPool;

    // Lazy initialization with ESM dynamic import workaround
    async ensureClient(): Promise<CopilotClient>;

    // Main API - matches existing AIInvocationResult interface
    async sendMessage(options: SendMessageOptions): Promise<SDKInvocationResult>;

    // Session management
    async abortSession(sessionId: string): Promise<void>;
    async cleanup(): Promise<void>;  // Called on extension deactivate
}
```

### Session Strategy
| Use Case | Strategy |
| --- | --- |
| Clarification (Markdown/Diff) | New session per request, destroy after |
| Code Review (parallel) | Session pool - reuse sessions |
| YAML Pipeline (parallel) | Session pool - reuse sessions |
| AI Discovery | New session, destroy after |

## Migration Phases

### Phase 1: Foundation
- [x] Create `copilot-sdk-service.ts` with singleton client
- [x] Implement ESM import workaround (from `copilot-sdk-experiment.ts`)
- [x] Add `isAvailable()` check and graceful fallback
- [x] Add configuration settings for SDK backend selection

### Phase 2: Session Pool
- [x] Create `session-pool.ts` for concurrent request handling
- [x] Implement acquire/release/destroy lifecycle
- [x] Add idle timeout cleanup
- [x] Add max concurrency limiting

### Phase 3: Migrate Simple Consumers
- [x] Update `ai-clarification-handler-base.ts` to use SDK
- [x] Test Markdown Comments clarification
- [x] Test Git Diff Comments clarification

### Phase 4: Migrate Parallel Consumers
- [x] Update Code Review to use session pool
- [x] Update YAML Pipeline to use session pool
- [x] Performance test parallel requests

### Phase 5: AI Processes Panel Integration
- [ ] Add `sdkSessionId` field to internal `TrackedProcess` interface
- [ ] Update `AIProcessManager.cancelProcess()` to handle SDK session abort
- [ ] Ensure status mapping (SDK states → `AIProcessStatus`) works correctly
- [ ] Test panel displays processes identically for CLI and SDK backends
- [ ] Verify cancellation from panel context menu works with SDK

### Phase 6: Complete Migration
- [ ] Update AI Discovery engine
- [ ] Add streaming support where beneficial
- [ ] Update documentation

## AI Processes Panel Compatibility

The AI Processes panel (`AIProcessTreeDataProvider`) displays running and completed AI processes. The SDK migration must maintain the same interface so the panel works identically regardless of backend.

### Interface Unchanged

The public `AIProcess` interface is already backend-agnostic:
```typescript
interface AIProcess {
    id: string;
    type: AIProcessType;
    promptPreview: string;
    fullPrompt: string;
    status: AIProcessStatus;  // 'running' | 'completed' | 'failed' | 'cancelled'
    startTime: Date;
    endTime?: Date;
    error?: string;
    result?: string;
    // ... metadata fields
}
```

The `ChildProcess` reference is internal to `TrackedProcess` (not exposed). For SDK, we add an optional session reference:

```typescript
// Internal tracking (not public API)
interface TrackedProcess extends AIProcess {
    childProcess?: ChildProcess;      // CLI backend
    sdkSessionId?: string;            // SDK backend
}
```

### No Changes Required

| Component | Changes |
| --- | --- |
| `AIProcess` interface | None - already backend-agnostic |
| `AIProcessStatus` enum | None - SDK maps to same states |
| `AIProcessTreeDataProvider` | None - uses stable `AIProcess` interface |
| `IAIProcessManager` interface | None - public API unchanged |

### Internal Changes (AIProcessManager)

1. **Session tracking**: Store `sdkSessionId` alongside or instead of `childProcess`
2. **Cancellation**: Call `copilotSDKService.abortSession(sessionId)` instead of `childProcess.kill()`
3. **Status mapping**: SDK session states map directly to existing `AIProcessStatus`:
   - SDK active → `'running'`
   - SDK success → `'completed'`
   - SDK error → `'failed'`
   - SDK aborted → `'cancelled'`

### Verification

- Panel displays processes identically for CLI and SDK backends
- Process status updates in real-time
- Cancellation works from panel context menu
- Persistence/restore works on extension restart

## Configuration Changes

Add to `package.json`:
```json
"workspaceShortcuts.aiService.backend": {
    "type": "string",
    "enum": ["copilot-sdk", "copilot-cli", "clipboard"],
    "default": "copilot-cli",
    "description": "AI backend (SDK recommended)"
},
"workspaceShortcuts.aiService.sdk.maxSessions": {
    "type": "number",
    "default": 5
},
"workspaceShortcuts.aiService.sdk.sessionTimeout": {
    "type": "number",
    "default": 300000
}
```

## Critical Files to Modify

1. **`src/shortcuts/ai-service/copilot-sdk-service.ts`** (NEW) - Core SDK wrapper
2. **`src/shortcuts/ai-service/session-pool.ts`** (NEW) - Session management
3. **`src/shortcuts/ai-service/types.ts`** - Add SDK types
4. **`src/shortcuts/shared/ai-clarification-handler-base.ts`** - First consumer migration
5. **`src/shortcuts/code-review/code-review-commands.ts`** - Parallel consumer
6. **`src/shortcuts/yaml-pipeline/ui/pipeline-executor-service.ts`** - Parallel consumer
7. **`src/shortcuts/ai-service/ai-process-manager.ts`** - SDK session tracking
8. **`package.json`** - New configuration settings

## Fallback Strategy
```typescript
async function invokeAI(prompt, options): Promise<AIInvocationResult> {
    const backend = getAIBackendSetting();

    if (backend === 'copilot-sdk') {
        try {
            return await copilotSDKService.sendMessage({ prompt, ...options });
        } catch (error) {
            logger.warn('SDK failed, falling back to CLI', error);
        }
    }

    if (backend === 'copilot-cli' || backend === 'copilot-sdk') {
        return await invokeCopilotCLI(prompt, ...);
    }

    // clipboard fallback
    await copyToClipboard(prompt);
    return { success: false, error: 'Copied to clipboard' };
}
```

## Verification

1. **Unit Tests**: Mock SDK client/session, test pool management
2. **Integration**: Test with actual Copilot CLI installed
3. **Consumer Tests**: Verify identical results CLI vs SDK
4. **Performance**: Compare response times, memory usage
5. **Manual Testing**:
   - Run clarification from Markdown Review editor
   - Run code review with multiple rules
   - Execute YAML pipeline with multiple rows
   - Test cancellation during long request
