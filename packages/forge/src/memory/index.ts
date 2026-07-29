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

// Memory security scanner (canonical impl re-exported from @plusplusoneplusplus/coc-memory)
export { scanMemoryContent, redactSensitiveValues, SECURITY_PATTERNS_DESCRIPTION } from './memory-security-scanner';
export type { MemoryScanResult, ThreatPatternId } from './memory-security-scanner';
