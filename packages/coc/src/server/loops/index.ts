export type {
    LoopEntry,
    LoopStatus,
    LoopChangeEvent,
} from './loop-types';

export {
    MIN_LOOP_INTERVAL_MS,
    MIN_WAKEUP_DELAY_MS,
    DEFAULT_LOOP_TTL_MS,
    MAX_CONSECUTIVE_FAILURES,
    MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS,
    MAX_ACTIVE_LOOPS,
} from './loop-types';

export { LoopStore } from './loop-store';

export { LoopExecutor } from './loop-executor';
export type { LoopEventEmit, LoopExecutorDeps } from './loop-executor';
