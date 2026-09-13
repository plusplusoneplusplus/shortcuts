/**
 * Regression coverage that the workflow package's AI timeout defaults stay in
 * lockstep with the provider SDK package. The workflow package carries its own
 * copies, so nothing but a test stops the two from drifting apart.
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_AI_TIMEOUT_MS as SDK_TIMEOUT_MS,
    DEFAULT_AI_IDLE_TIMEOUT_MS as SDK_IDLE_TIMEOUT_MS,
} from '@plusplusoneplusplus/coc-agent-sdk';
import { DEFAULT_AI_TIMEOUT_MS, DEFAULT_AI_IDLE_TIMEOUT_MS } from '../../src/config/defaults';

describe('workflow AI timeout defaults', () => {
    it('caps a single request at 8 hours', () => {
        expect(DEFAULT_AI_TIMEOUT_MS).toBe(8 * 60 * 60 * 1000);
    });

    it('matches the provider SDK defaults', () => {
        expect(DEFAULT_AI_TIMEOUT_MS).toBe(SDK_TIMEOUT_MS);
        expect(DEFAULT_AI_IDLE_TIMEOUT_MS).toBe(SDK_IDLE_TIMEOUT_MS);
    });
});
