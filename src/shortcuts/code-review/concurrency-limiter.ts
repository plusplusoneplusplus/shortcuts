/**
 * ConcurrencyLimiter
 *
 * Re-exports from the map-reduce framework for backward compatibility.
 * Controls parallel execution of async tasks with a configurable concurrency limit.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// Re-export from map-reduce framework
export { ConcurrencyLimiter, DEFAULT_MAX_CONCURRENCY } from '../map-reduce/concurrency-limiter';
