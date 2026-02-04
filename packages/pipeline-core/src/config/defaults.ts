/**
 * Centralized Defaults
 *
 * Single source of truth for all DEFAULT_* constants used across the pipeline-core package.
 * This consolidates scattered defaults for better discoverability and maintainability.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Timeouts
// ============================================================================

/**
 * Default AI request timeout (30 minutes).
 * Used for individual AI calls in pipelines, map-reduce, and queue tasks.
 */
export const DEFAULT_AI_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Default poll interval for process monitoring (5 seconds).
 */
export const DEFAULT_POLL_INTERVAL_MS = 5000;

// ============================================================================
// Concurrency & Parallelism
// ============================================================================

/**
 * Default parallel limit for pipeline map operations.
 */
export const DEFAULT_PARALLEL_LIMIT = 5;

/**
 * Default maximum concurrency for map-reduce operations.
 */
export const DEFAULT_MAX_CONCURRENCY = 5;

// ============================================================================
// Session Pool
// ============================================================================

/**
 * Default maximum number of sessions in the pool.
 */
export const DEFAULT_MAX_SESSIONS = 5;

/**
 * Default idle timeout for pool sessions (5 minutes).
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 300000;

/**
 * Default minimum number of sessions to keep in the pool.
 */
export const DEFAULT_MIN_SESSIONS = 0;

/**
 * Default cleanup interval for the session pool (1 minute).
 */
export const DEFAULT_CLEANUP_INTERVAL_MS = 60000;

/**
 * Default timeout for acquiring a session from the pool (30 seconds).
 */
export const DEFAULT_ACQUIRE_TIMEOUT_MS = 30000;

// ============================================================================
// Chunk Splitter
// ============================================================================

/**
 * Default maximum chunk size in characters.
 */
export const DEFAULT_CHUNK_MAX_SIZE = 4000;

/**
 * Default overlap size between chunks in characters.
 */
export const DEFAULT_CHUNK_OVERLAP_SIZE = 200;

/**
 * Default chunk strategy.
 */
export const DEFAULT_CHUNK_STRATEGY: 'character' | 'line' | 'paragraph' = 'character';

/**
 * Default setting for preserving boundaries in chunk splitting.
 */
export const DEFAULT_CHUNK_PRESERVE_BOUNDARIES = true;

// ============================================================================
// CSV Reader
// ============================================================================

/**
 * Default CSV delimiter.
 */
export const DEFAULT_CSV_DELIMITER = ',';

/**
 * Default CSV quote character.
 */
export const DEFAULT_CSV_QUOTE = '"';

/**
 * Default setting for CSV header presence.
 */
export const DEFAULT_CSV_HAS_HEADER = true;

/**
 * Default setting for skipping empty lines in CSV.
 */
export const DEFAULT_CSV_SKIP_EMPTY_LINES = true;

/**
 * Default setting for trimming fields in CSV.
 */
export const DEFAULT_CSV_TRIM_FIELDS = true;

// ============================================================================
// Queue Executor
// ============================================================================

/**
 * Default number of retry attempts for queue tasks.
 */
export const DEFAULT_RETRY_ATTEMPTS = 3;

/**
 * Default delay between retries in milliseconds.
 */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * Default maximum concurrent tasks in the queue executor.
 */
export const DEFAULT_QUEUE_MAX_CONCURRENT = 3;

/**
 * Default process on startup setting.
 */
export const DEFAULT_QUEUE_PROCESS_ON_STARTUP = true;

/**
 * Default auto-start setting for queue manager.
 */
export const DEFAULT_QUEUE_AUTO_START = true;

/**
 * Default setting for automatic queue persistence.
 */
export const DEFAULT_QUEUE_AUTO_PERSIST = true;

// ============================================================================
// Skills
// ============================================================================

/**
 * Default directory for skill definitions.
 */
export const DEFAULT_SKILLS_DIRECTORY = '.github/skills';

// ============================================================================
// Text Matching
// ============================================================================

/**
 * Default fuzzy match threshold (0-1).
 */
export const DEFAULT_FUZZY_MATCH_THRESHOLD = 0.7;

/**
 * Default context lines to include around matches.
 */
export const DEFAULT_CONTEXT_LINES = 3;

/**
 * Default case sensitivity for text matching.
 */
export const DEFAULT_CASE_SENSITIVE = false;
