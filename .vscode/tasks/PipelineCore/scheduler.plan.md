# AI Process Scheduler for Pipeline Core

## Problem Statement

The pipeline core currently uses a simple `ConcurrencyLimiter` for managing parallel AI tasks. While effective for basic concurrency control, it lacks scheduling features that would enable:

- **Priority-based execution** - Urgent tasks should run before background tasks
- **Fair scheduling** - Prevent task starvation when high-priority tasks keep arriving
- **Rate limiting** - Control requests per time window to respect API quotas
- **Queue management** - Visibility into pending tasks and ability to reorder/cancel

## Proposed Approach

Add a lightweight `AIScheduler` class in `packages/pipeline-core/src/ai/` that wraps the existing `ConcurrencyLimiter` with scheduling capabilities. This preserves backward compatibility while enabling advanced scheduling for pipelines that need it.

**Design Principles:**
- Extend, don't replace - the existing `ConcurrencyLimiter` remains the execution primitive
- Keep it simple - start with essential features, avoid over-engineering
- Optional adoption - pipelines can use the scheduler or continue with the limiter directly

## Work Plan

- [ ] **1. Create AIScheduler types** (`packages/pipeline-core/src/ai/scheduler-types.ts`)
  - `ScheduledTask` interface with id, priority, callback, metadata
  - `SchedulerOptions` interface with maxConcurrency, priorityLevels, enableFairness
  - `SchedulerStats` interface for monitoring (queued, running, completed counts)
  - Priority levels enum: `high`, `normal`, `low`

- [ ] **2. Implement AIScheduler class** (`packages/pipeline-core/src/ai/scheduler.ts`)
  - Priority queue using sorted array (simple, sufficient for expected load)
  - `schedule<T>(task, priority?, metadata?)` - returns Promise<T>
  - `cancel(taskId)` - cancel a pending task
  - `getStats()` - return current scheduler statistics
  - `pause()/resume()` - pause/resume task execution
  - Internal integration with `ConcurrencyLimiter` for actual execution
  - Optional fairness: after N high-priority tasks, run one lower-priority

- [ ] **3. Add rate limiting support** (`packages/pipeline-core/src/ai/rate-limiter.ts`)
  - Token bucket algorithm for requests-per-minute limiting
  - Configurable rate and burst size
  - Can be combined with scheduler or used standalone

- [ ] **4. Export from package index**
  - Add exports to `packages/pipeline-core/src/ai/index.ts`
  - Add exports to `packages/pipeline-core/src/index.ts`

- [ ] **5. Write unit tests** (`packages/pipeline-core/test/scheduler.test.ts`)
  - Priority ordering tests
  - Fairness tests (no starvation)
  - Cancellation tests
  - Rate limiting tests
  - Integration with ConcurrencyLimiter

- [ ] **6. Update documentation**
  - Add usage examples to CLAUDE.md or create README in ai/ folder
  - Document configuration options

## API Design Sketch

```typescript
// Usage example
import { AIScheduler, Priority } from 'pipeline-core';

const scheduler = new AIScheduler({
  maxConcurrency: 5,
  enableFairness: true,
  fairnessWindow: 10  // After 10 high-priority tasks, run 1 lower
});

// Schedule tasks with priority
const result1 = await scheduler.schedule(
  () => aiInvoker('prompt 1'),
  Priority.HIGH
);

const result2 = scheduler.schedule(
  () => aiInvoker('prompt 2'),
  Priority.LOW,
  { id: 'task-123' }  // Optional metadata
);

// Cancel pending task
scheduler.cancel('task-123');

// Get stats
const stats = scheduler.getStats();
// { queued: 5, running: 3, completed: 12, byPriority: { high: 2, normal: 2, low: 1 } }
```

## Notes & Considerations

- **Why not use an existing library?** Keeping dependencies minimal in pipeline-core. The implementation is simple enough (~150-200 LOC).
- **Thread safety** - Not needed; Node.js is single-threaded. The async queue pattern handles concurrency.
- **Memory** - For very large queues (1000s of tasks), consider a heap-based priority queue. For typical pipeline sizes (<100 items), sorted array is fine.
- **Backward compatibility** - Existing code using `ConcurrencyLimiter` or `MapReduceExecutor` continues to work unchanged.

## Open Questions

1. Should the scheduler support task dependencies (DAG scheduling)?
   - *Tentative answer: No, keep it simple. Pipeline YAML handles sequential phases.*

2. Should rate limiting be built into the scheduler or separate?
   - *Tentative answer: Separate class that can wrap the scheduler. Composition over inheritance.*

3. Should we add retry logic to the scheduler?
   - *Tentative answer: No, retry is already handled by MapReduceExecutor. Scheduler just schedules.*
