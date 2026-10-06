/**
 * Verifies SDK permission helpers and backward compatibility through the ai/ re-exports.
 */

import { describe, it, expect } from 'vitest';

import {
    approveAllPermissions,
    denyAllPermissions,
    VALID_MODELS,
    DEFAULT_MODEL_ID,
    MODEL_REGISTRY,
    CopilotSDKService,
    resetCopilotSDKService,
} from '@plusplusoneplusplus/coc-agent-sdk';

import {
    approveAllPermissions as aiApproveAll,
    denyAllPermissions as aiDenyAll,
    CopilotSDKService as AiCopilotSDKService,
    resetCopilotSDKService as aiResetService,
    VALID_MODELS as AiVALID_MODELS,
    DEFAULT_MODEL_ID as AiDEFAULT_MODEL_ID,
    MODEL_REGISTRY as AiMODEL_REGISTRY,
    DEFAULT_PROMPTS,
} from '../../src/ai';

describe('Copilot SDK Wrapper Module', () => {
    describe('permission helpers', () => {
        it('approveAllPermissions should return approved', () => {
            const result = approveAllPermissions(
                { kind: 'shell' },
                { sessionId: 'test' }
            );
            expect(result).toEqual({ kind: 'approve-once' });
        });

        it('denyAllPermissions should return denied-by-rules', () => {
            const result = denyAllPermissions(
                { kind: 'write' },
                { sessionId: 'test' }
            );
            expect(result).toEqual({ kind: 'reject' });
        });
    });

    describe('backward compatibility via ai/ barrel', () => {
        it('should re-export the same CopilotSDKService class', () => {
            expect(AiCopilotSDKService).toBe(CopilotSDKService);
        });

        it('should re-export the same permission helpers', () => {
            expect(aiApproveAll).toBe(approveAllPermissions);
            expect(aiDenyAll).toBe(denyAllPermissions);
        });

        it('should re-export the same convenience functions', () => {
            expect(aiResetService).toBe(resetCopilotSDKService);
        });

        it('should re-export model constants', () => {
            expect(AiVALID_MODELS).toBe(VALID_MODELS);
            expect(AiDEFAULT_MODEL_ID).toBe(DEFAULT_MODEL_ID);
            expect(AiMODEL_REGISTRY).toBe(MODEL_REGISTRY);
        });

        it('should still export AI-specific types from ai/', () => {
            expect(DEFAULT_PROMPTS).toBeDefined();
            expect(DEFAULT_PROMPTS.clarify).toBeDefined();
            expect(DEFAULT_PROMPTS.goDeeper).toBeDefined();
        });
    });
});
