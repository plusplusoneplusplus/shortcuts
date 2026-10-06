/**
 * Parity tests: Forge's memory security scanner is a thin compatibility
 * re-export of the canonical implementation in @plusplusoneplusplus/coc-memory.
 *
 * These prove the two packages expose the *same* implementation (function
 * identity, not just equivalent behavior), so a fix applied to the canonical
 * module is automatically enforced through the Forge import path.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import * as forgeScanner from '../../src/memory/memory-security-scanner';
import * as canonical from '@plusplusoneplusplus/coc-memory';
import type { MemoryScanResult, ThreatPatternId } from '../../src/memory/memory-security-scanner';

describe('memory-security-scanner — cross-package identity', () => {
    it('re-exports the exact canonical scanMemoryContent function', () => {
        expect(forgeScanner.scanMemoryContent).toBe(canonical.scanMemoryContent);
    });

    it('re-exports the exact canonical redactSensitiveValues function', () => {
        expect(forgeScanner.redactSensitiveValues).toBe(canonical.redactSensitiveValues);
    });

    it('re-exports the exact canonical SECURITY_PATTERNS_DESCRIPTION value', () => {
        expect(forgeScanner.SECURITY_PATTERNS_DESCRIPTION).toBe(canonical.SECURITY_PATTERNS_DESCRIPTION);
    });
});

describe('memory-security-scanner — compile-time type compatibility', () => {
    it('MemoryScanResult and ThreatPatternId match the canonical shapes', () => {
        expectTypeOf<MemoryScanResult>().toEqualTypeOf<canonical.MemoryScanResult>();
        expectTypeOf<ThreatPatternId>().toEqualTypeOf<canonical.ThreatPatternId>();
        expectTypeOf<'invisible_unicode'>().toMatchTypeOf<ThreatPatternId>();
    });
});
