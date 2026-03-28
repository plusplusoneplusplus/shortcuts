import type { QueuedTask } from '@plusplusoneplusplus/forge';

/** Normalized executor interface for all task execution strategies. */
export interface ITaskExecutor {
    execute(task: QueuedTask, prompt: string): Promise<unknown>;
}
