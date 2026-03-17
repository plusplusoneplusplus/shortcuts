/**
 * Vitest global setup — Safety net that prevents real Copilot SDK calls in tests.
 *
 * Auto-mocks `getCopilotSDKService` from `@plusplusoneplusplus/forge`
 * to return a stub that **throws** if any method is called. Tests that need AI
 * should inject a mock `aiService` via `createExecutionServer({ aiService })`.
 */

import { vi, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const original = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...original,
        getCopilotSDKService: () => ({
            sendMessage: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            isAvailable: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            sendFollowUp: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            hasKeptAliveSession: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            canResumeSession: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
        }),
    };
});
