/**
 * Memory System
 *
 * Re-exports all memory types, interfaces, store implementations,
 * and security scanner.
 */
export type {
    RepoInfo,
    GitRemoteInfo,
    MemoryLevel,
} from './types';

export { computeRepoHash } from './repo-hash';
export { BaseFileStore } from './base-file-store';

// Memory security scanner
export { scanMemoryContent, SECURITY_PATTERNS_DESCRIPTION } from './memory-security-scanner';
export type { MemoryScanResult, ThreatPatternId } from './memory-security-scanner';

// Memory tool
export { createMemoryTool, MEMORY_SCHEMA, getMemorySchema } from './memory-tool';
export type {
    MemoryToolOptions,
    MemoryToolArgs,
    MemoryToolMode,
    MemoryToolCaptureContext,
    MemoryToolCaptureResult,
    MemoryWriteFrequency,
    MemoryCandidateCapturedCallback,
    CapturedCandidate,
} from './memory-tool';
