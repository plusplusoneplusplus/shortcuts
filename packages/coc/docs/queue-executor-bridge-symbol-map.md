# queue-executor-bridge.ts — Symbol Map

Audit produced by commit `chore: audit queue-executor-bridge symbol map`.
Every exported and internal symbol is listed below with its target module in
the desired end-state (see `CONTEXT.md`) and its dependencies on other symbols.

---

## Legend

| Column | Meaning |
|---|---|
| **Symbol** | Name as it appears in source |
| **Kind** | `const` / `fn` / `interface` / `class` / `method (public)` / `method (private)` / `static field` |
| **Visibility** | `export` = public API, `internal` = not exported |
| **Target module** | Destination path under `packages/coc/src/server/` after extraction |
| **Dependencies** | Other symbols in this file that must be co-located or imported |

---

## 1. Constants

| Symbol | Kind | Visibility | Target module | Dependencies |
|---|---|---|---|---|
| `TERMINAL_STATUSES` | `const` | internal | `executors/base-executor.ts` | — |
| `CHAT_MODE_TO_AGENT_MODE` | `const` | internal | `executors/base-executor.ts` | — |
| `CLITaskExecutor.THROTTLE_TIME_MS` | static field | internal | `executors/base-executor.ts` | — |
| `CLITaskExecutor.THROTTLE_CHUNK_COUNT` | static field | internal | `executors/base-executor.ts` | — |

---

## 2. Internal Helper Functions

| Symbol | Kind | Visibility | Target module | Dependencies |
|---|---|---|---|---|
| `toAgentMode` | `fn` | internal | `executors/base-executor.ts` | `CHAT_MODE_TO_AGENT_MODE` |
| `buildModeSystemMessage` | `fn` | internal | `executors/prompt-builder.ts` | `toAgentMode` (indirect — uses `AutoFolderContext`/`buildAutoFolderLocationBlock` from forge) |
| `withRepoInstructions` | `fn` | internal | `executors/prompt-builder.ts` | — (pure async, no in-file deps) |

> **Cross-cutting note:** `buildModeSystemMessage` and `withRepoInstructions` are
> called from both `executeFollowUp` (follow-up-executor) and the standard-chat
> branch of `executeByType` (ask/autopilot executors).  They must live in a
> shared module that all executor modules can import — `prompt-builder.ts` is the
> natural home.

---

## 3. Exported Interfaces

| Symbol | Kind | Visibility | Target module | Dependencies |
|---|---|---|---|---|
| `CLITaskExecutorOptions` | `interface` | export | `executors/base-executor.ts` | `CopilotSDKService` (forge), `ProcessWebSocketServer` (websocket) |
| `QueueExecutorBridgeOptions` | `interface` | export | `queue-executor-bridge.ts` (facade) | `CLITaskExecutorOptions`, `QueuedTask` (forge) |
| `QueueExecutorBridge` | `interface` | export | `queue-executor-bridge.ts` (facade) | `Attachment` (forge) |

---

## 4. Internal Interfaces

| Symbol | Kind | Visibility | Target module | Dependencies |
|---|---|---|---|---|
| `ProcessSessionState` | `interface` | internal | `executors/base-executor.ts` | `TimelineItem` (forge) |

> **Cross-cutting note:** `ProcessSessionState` is the single source of truth for
> per-process streaming state (output buffer, timeline buffer, throttle counters,
> pending suggestions).  It is read and written by every streaming path
> (`executeWithAI`, `executeFollowUp`, `checkThrottleAndFlush`,
> `flushConversationTurn`, `appendTimelineItem`, `cleanupSession`).
> All of these methods must live in — or import from — `base-executor.ts`.

---

## 5. Class: `CLITaskExecutor`

Exported.  Implements `TaskExecutor` (forge) and `QueueExecutorBridge`.

### 5a. Instance Fields

| Field | Visibility | Target module | Notes |
|---|---|---|---|
| `store: ProcessStore` | private | `base-executor.ts` | Injected; used everywhere |
| `cancelledTasks: Set<string>` | private | `base-executor.ts` | Cancellation registry |
| `approvePermissions: boolean` | private | `base-executor.ts` | Passed to all AI calls |
| `defaultWorkingDirectory?: string` | private | `base-executor.ts` | Fallback cwd |
| `dataDir?: string` | private | `base-executor.ts` | Used for output files, skills, task root |
| `aiService: CopilotSDKService` | private | `base-executor.ts` | Injected or default |
| `defaultTimeoutMs: number` | private | `base-executor.ts` | Per-task timeout fallback |
| `sessions: Map<string, ProcessSessionState>` | private | `base-executor.ts` | **Streaming state**; only `base-executor` may hold this |
| `followUpSuggestions: { enabled, count }` | private | `base-executor.ts` | Config forwarded to follow-up/chat executors |
| `getWsServer?: () => ProcessWebSocketServer` | private | `base-executor.ts` | Used in `executeResolveComments` |
| `queueManager?: TaskQueueManager` | private | `base-executor.ts` | Injected by factory; used in title generation and follow-up requeue |
| `registry: TaskStrategyRegistry` | private | `base-executor.ts` | Dispatch for `run-script` / `replicate-template` |

### 5b. Public Methods

| Method | Target module | Dependencies on other in-file symbols |
|---|---|---|
| `constructor` | `base-executor.ts` | All instance fields; `RunScriptStrategy`, `ReplicateTemplateStrategy` |
| `setQueueManager(qm)` | `base-executor.ts` | `queueManager` field |
| `execute(task)` ← `TaskExecutor` contract | `base-executor.ts` | `extractPrompt`, `applySkillContent`, `getWorkingDirectory`, `executeByType`, `generateTitleIfNeeded`, `cleanupSession`, `persistOutput`, `TERMINAL_STATUSES`, `sessions`, `ImageBlobStore` |
| `cancel(taskId)` ← `TaskExecutor` contract | `base-executor.ts` | `cancelledTasks` |
| `cancelProcess(processId)` ← `QueueExecutorBridge` | `base-executor.ts` | `cancelledTasks`, `aiService` |
| `isSessionAlive(processId)` ← `QueueExecutorBridge` | `base-executor.ts` | — |
| `requeueForFollowUp(taskId, ...)` ← `QueueExecutorBridge` | `executors/follow-up-executor.ts` | `queueManager`, `applyFollowUpToTask` |
| `executeFollowUp(processId, message, ...)` ← `QueueExecutorBridge` | `executors/follow-up-executor.ts` | `buildModeSystemMessage`, `withRepoInstructions`, `resolveSkillConfig`, `buildConversationHistoryContext`, `getOrCreateSession`, `buildFollowUpSuggestionsAddon`, `buildToolEventHandler`, `toAgentMode`, `checkThrottleAndFlush`, `appendTimelineItem`, `cleanupSession`, `persistOutput`, `generateTitleIfNeeded`, `TERMINAL_STATUSES`, `sessions`, `resolveTaskRoot`, `emitMessageSteering` |

### 5c. Private Methods

| Method | Target module | Dependencies on other in-file symbols |
|---|---|---|
| `resolveWorkspaceIdForPath(rootPath)` | `base-executor.ts` | `store` |
| `generateTitleIfNeeded(processId, turns)` | `base-executor.ts` | `store`, `aiService`, `queueManager` |
| `buildFollowUpSuggestionsAddon(enabled)` | `executors/follow-up-executor.ts` | `followUpSuggestions`, `createSuggestFollowUpsTool` |
| `buildToolEventHandler(processId, computeTurnIndex)` | `base-executor.ts` | `getOrCreateSession`, `appendTimelineItem`, `checkThrottleAndFlush`, `store` |
| `buildConversationHistoryContext(turns)` | `executors/follow-up-executor.ts` | — (pure transformation) |
| `extractPrompt(task)` | `executors/prompt-builder.ts` | `findContextFileSuffix`, `buildFollowPromptText` (forge) |
| `applySkillContent(prompt, task)` | `executors/prompt-builder.ts` | — (pure transformation) |
| `buildExecutionContext(task)` | `base-executor.ts` | `getWorkingDirectory`, `store`, `approvePermissions` |
| `executeByType(task, prompt)` | `base-executor.ts` (dispatcher) | `TaskExecutorRegistry`, `executeRunPipeline`, `executeWithAI`, `getWorkingDirectory`, `registry` |
| `executeWithAI(task, prompt, options)` | `base-executor.ts` | `getOrCreateSession`, `buildToolEventHandler`, `checkThrottleAndFlush`, `appendTimelineItem`, `toAgentMode`, `resolveSkillConfig`, `getWorkingDirectory`, `ImageBlobStore`, `saveImagesToTempFiles`, `cleanupTempDir` |
| `TaskGenerationExecutor.executeTask(task)` | `executors/task-generation-executor.ts` | `executeWithAI`, `resolveTaskRoot`, `resolveWorkspaceIdForPath`, `gatherFeatureContext` (forge), prompt-builder helpers (forge) |
| `executeRunPipeline(task)` | `executors/workflow-executor.ts` | `createCLIAIInvoker`, `compileToWorkflow`/`executeWorkflow`/`flattenWorkflowResult` (forge), `store` |
| `executeResolveComments(task)` | `executors/chat-executor.ts` | `executeWithAI`, `store`, `getWsServer`, `dataDir`, `TaskCommentsManager` |
| `getWorkingDirectory(task)` | `base-executor.ts` | — |
| `resolveSkillConfig(wsId, workingDirectory)` | `base-executor.ts` | `store`, `dataDir`, `DEFAULT_SKILLS_SETTINGS` (forge) |
| `findContextFileSuffix(planFilePath)` | `executors/prompt-builder.ts` | `toNativePath` (forge) |
| `getOrCreateSession(processId)` | `base-executor.ts` | `sessions`, `ProcessSessionState` |
| `cleanupSession(processId)` | `base-executor.ts` | `sessions` |
| `appendTimelineItem(processId, item)` | `base-executor.ts` | `getOrCreateSession` |
| `checkThrottleAndFlush(processId)` | `base-executor.ts` | `getOrCreateSession`, `flushConversationTurn`, `THROTTLE_TIME_MS`, `THROTTLE_CHUNK_COUNT` |
| `flushConversationTurn(processId, streaming)` | `base-executor.ts` | `sessions`, `store`, `mergeConsecutiveContentItems` (forge) |
| `persistOutput(processId, content)` | `base-executor.ts` | `OutputFileManager`, `store`, `dataDir` |

---

## 6. Exported Free Functions

| Symbol | Kind | Visibility | Target module | Dependencies |
|---|---|---|---|---|
| `defaultIsExclusive` | `fn` | export | `queue-executor-bridge.ts` (facade) | `isChatPayload` (task-types) |
| `createQueueExecutorBridge` | `fn` | export | `queue-executor-bridge.ts` (facade) | `CLITaskExecutor`, `createQueueExecutor` (forge), `defaultIsExclusive` |

---

## 7. Target Module Summary

| Target module | Symbols landing there |
|---|---|
| `executors/base-executor.ts` | `TERMINAL_STATUSES`, `CHAT_MODE_TO_AGENT_MODE`, `THROTTLE_TIME_MS`, `THROTTLE_CHUNK_COUNT`, `toAgentMode`, `CLITaskExecutorOptions`, `ProcessSessionState`, `CLITaskExecutor` class (constructor, all session/stream/cancel/lifecycle methods: `setQueueManager`, `execute`, `cancel`, `cancelProcess`, `isSessionAlive`, `generateTitleIfNeeded`, `buildToolEventHandler`, `buildExecutionContext`, `executeByType`, `executeWithAI`, `getWorkingDirectory`, `resolveSkillConfig`, `resolveWorkspaceIdForPath`, `getOrCreateSession`, `cleanupSession`, `appendTimelineItem`, `checkThrottleAndFlush`, `flushConversationTurn`, `persistOutput`) |
| `executors/prompt-builder.ts` | `buildModeSystemMessage`, `withRepoInstructions`, `extractPrompt`, `applySkillContent`, `findContextFileSuffix` |
| `executors/follow-up-executor.ts` | `requeueForFollowUp`, `executeFollowUp`, `buildFollowUpSuggestionsAddon`, `buildConversationHistoryContext` |
| `executors/task-generation-executor.ts` | `TaskGenerationExecutor` |
| `executors/chat-executor.ts` | ask-mode chat branch of `executeByType` |
| `executors/resolve-comments-executor.ts` | resolve-comments branch of `executeByType` |
| `executors/autopilot-executor.ts` | autopilot chat branch of `executeByType` (no unique private method today — dispatches through `executeWithAI`) |
| `executors/workflow-executor.ts` | `executeRunPipeline` |
| `executors/shell-executor.ts` | `run-script` dispatch (currently via `registry.get('run-script')` — `RunScriptStrategy` already in a separate file) |
| `executors/image-store.ts` | no symbols currently owned inline; image I/O already delegated to `image-utils.ts` and `ImageBlobStore` |
| `queue-executor-bridge.ts` (facade) | `QueueExecutorBridgeOptions`, `QueueExecutorBridge`, `defaultIsExclusive`, `createQueueExecutorBridge` |

---

## 8. Cross-Cutting Dependency Constraints

These relationships constrain the extraction order:

1. **Streaming state is indivisible.**  
   `ProcessSessionState` + `sessions` map + `getOrCreateSession` + `cleanupSession` + `appendTimelineItem` + `checkThrottleAndFlush` + `flushConversationTurn` **must all land in `base-executor.ts`** before any executor module is extracted.  No executor module may own its own streaming lifecycle.

2. **`executeWithAI` is the only AI call site for chat tasks.**  
   All of `chat-executor`, `task-generation-executor`, `autopilot-executor`, and `follow-up-executor` delegate to `executeWithAI` in `base-executor.ts`.  Extract `executeWithAI` before those modules.

3. **`buildModeSystemMessage` + `withRepoInstructions` are shared across `follow-up-executor` and all chat-mode executors.**  
   Extract `prompt-builder.ts` before extracting any chat executor.

4. **`resolveSkillConfig` is called from `executeWithAI` and `executeFollowUp`.**  
   It stays in `base-executor.ts` so both callers remain in the same module until `follow-up-executor` is split out.

5. **`toAgentMode` is consumed by `executeWithAI` and `executeFollowUp`.**  
   Keep in `base-executor.ts` and re-export from there; callers import from the same place.

6. **`requeueForFollowUp` depends on `queueManager` (injected at runtime by the factory).**  
   The factory (`createQueueExecutorBridge`) and the `setQueueManager` method must remain aligned even after extraction.

7. **`executeResolveComments` dynamically imports `resolve-comment-tool` and `TaskCommentsManager`.**  
   Move to `chat-executor.ts` intact; dynamic imports survive the move.

8. **`defaultIsExclusive` is referenced directly by `createQueueExecutorBridge`.**  
   Both must stay in the final `queue-executor-bridge.ts` facade (or be co-located and re-exported from there).
