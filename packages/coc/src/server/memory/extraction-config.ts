/**
 * Extraction Configuration
 *
 * Configuration types and defaults for the memory extraction subsystem.
 * Read from `resolvedConfig.memory.extraction` when available,
 * otherwise uses hardcoded defaults.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Types
// ============================================================================

export interface ExtractionConfig {
    /** Whether the extraction sweep is enabled server-wide. Default: true. */
    enabled: boolean;
    /** How often the sweep runs, in milliseconds. Default: 15 minutes. */
    sweepIntervalMs: number;
    /** How long a completed process must be idle before extraction. Default: 10 minutes. */
    idleThresholdMs: number;
    /** Max processes to extract per sweep cycle. Default: 10. */
    batchSize: number;
    /** AI model used for extraction. Default: 'gpt-4.1'. */
    model: string;
    /** Minimum conversation turns to attempt extraction. Default: 2. */
    minTurns: number;
    /** Number of raw observations that triggers auto-consolidation. Default: 20. */
    consolidationThreshold: number;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
    enabled: true,
    sweepIntervalMs: 15 * 60_000,    // 15 minutes
    idleThresholdMs: 10 * 60_000,    // 10 minutes
    batchSize: 10,
    model: 'gpt-4.1',
    minTurns: 2,
    consolidationThreshold: 20,
};

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate and sanitize extraction config from a partial input.
 * Unknown keys are silently dropped; invalid values fall back to defaults.
 */
export function validateExtractionConfig(raw: unknown): ExtractionConfig {
    if (typeof raw !== 'object' || raw === null) {
        return { ...DEFAULT_EXTRACTION_CONFIG };
    }
    const obj = raw as Record<string, unknown>;
    return {
        enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_EXTRACTION_CONFIG.enabled,
        sweepIntervalMs: typeof obj.sweepIntervalMs === 'number' && obj.sweepIntervalMs > 0
            ? obj.sweepIntervalMs
            : DEFAULT_EXTRACTION_CONFIG.sweepIntervalMs,
        idleThresholdMs: typeof obj.idleThresholdMs === 'number' && obj.idleThresholdMs > 0
            ? obj.idleThresholdMs
            : DEFAULT_EXTRACTION_CONFIG.idleThresholdMs,
        batchSize: typeof obj.batchSize === 'number' && obj.batchSize > 0
            ? Math.floor(obj.batchSize)
            : DEFAULT_EXTRACTION_CONFIG.batchSize,
        model: typeof obj.model === 'string' && obj.model.length > 0
            ? obj.model
            : DEFAULT_EXTRACTION_CONFIG.model,
        minTurns: typeof obj.minTurns === 'number' && obj.minTurns >= 1
            ? Math.floor(obj.minTurns)
            : DEFAULT_EXTRACTION_CONFIG.minTurns,
        consolidationThreshold: typeof obj.consolidationThreshold === 'number' && obj.consolidationThreshold > 0
            ? Math.floor(obj.consolidationThreshold)
            : DEFAULT_EXTRACTION_CONFIG.consolidationThreshold,
    };
}
