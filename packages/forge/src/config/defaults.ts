/**
 * Single source of truth for all DEFAULT_* constants across the forge package.
 */

// ============================================================================
// Timeouts
// ============================================================================

/**
 * Default AI request timeout (6 hours).
 * Used for individual AI calls in pipelines, map-reduce, and queue tasks.
 */
export const DEFAULT_AI_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Default AI idle timeout (1 hour).
 * Resets on each streaming chunk/event. If no activity arrives within
 * this window, the session is force-destroyed.
 */
export const DEFAULT_AI_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

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

export const DEFAULT_CHUNK_STRATEGY: 'character' | 'line' | 'paragraph' = 'character';

export const DEFAULT_CHUNK_PRESERVE_BOUNDARIES = true;

// ============================================================================
// CSV Reader
// ============================================================================

export const DEFAULT_CSV_DELIMITER = ',';

export const DEFAULT_CSV_QUOTE = '"';

export const DEFAULT_CSV_HAS_HEADER = true;

export const DEFAULT_CSV_SKIP_EMPTY_LINES = true;

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

export const DEFAULT_QUEUE_PROCESS_ON_STARTUP = true;

export const DEFAULT_QUEUE_AUTO_START = true;

export const DEFAULT_QUEUE_AUTO_PERSIST = true;

// ============================================================================
// Skills
// ============================================================================

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

export const DEFAULT_CASE_SENSITIVE = false;
