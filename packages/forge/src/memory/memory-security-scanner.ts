/**
 * MemorySecurityScanner — compatibility re-exports.
 *
 * The canonical scanner now lives in `@plusplusoneplusplus/coc-memory`
 * (`safety-scanner.ts`). Forge re-exports it so the historical import path and
 * public API stay stable. Do NOT add pattern lists or scanning logic here —
 * extend the canonical module instead so both packages enforce one policy.
 *
 * The canonical contract is a strict superset of the old Forge one: it adds
 * CoC-environment, API-key, token, password, and connection-string checks plus
 * `redactSensitiveValues`. `ThreatPatternId` gains those ids and already folds
 * in `invisible_unicode`, so `MemoryScanResult.patternId` stays assignable to
 * the shape consumers relied on before.
 */

export type { ThreatPatternId, MemoryScanResult } from '@plusplusoneplusplus/coc-memory';
export {
    scanMemoryContent,
    redactSensitiveValues,
    SECURITY_PATTERNS_DESCRIPTION,
} from '@plusplusoneplusplus/coc-memory';
