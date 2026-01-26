/**
 * ConcurrencyLimiter
 *
 * Re-exports from the pipeline-core package for backward compatibility.
 * Controls parallel execution of async tasks with a configurable concurrency limit.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// Re-export from pipeline-core
export { ConcurrencyLimiter, DEFAULT_MAX_CONCURRENCY } from '@plusplusoneplusplus/pipeline-core';
