/**
 * Unit tests for the follow-up continuation decision (AC-04).
 *
 * The invariant under test: a native session id created by one provider is
 * never handed to another. Everything else here is about which of the two
 * continuation modes a follow-up lands in.
 */

import { describe, it, expect } from 'vitest';
import type { ActiveProviderSession } from '@plusplusoneplusplus/forge';
import { resolveContinuationMode } from '../../src/server/executors/continuation-mode';

function binding(overrides: Partial<ActiveProviderSession> = {}): ActiveProviderSession {
    return {
        provider: 'copilot',
        sessionId: 'copilot-session-1',
        segmentId: 'seg-1',
        firstTurnIndex: 0,
        ...overrides,
    };
}

describe('resolveContinuationMode', () => {
    it('resumes natively when no provider is requested', () => {
        const decision = resolveContinuationMode({ binding: binding() });

        expect(decision).toEqual({
            mode: 'native-resume',
            provider: 'copilot',
            resumeSessionId: 'copilot-session-1',
            providerChanged: false,
            strictResume: false,
        });
    });

    it('resumes natively when the requested provider matches the binding', () => {
        const decision = resolveContinuationMode({
            binding: binding(),
            requestedProvider: 'copilot',
        });

        expect(decision.mode).toBe('native-resume');
        expect(decision.resumeSessionId).toBe('copilot-session-1');
        expect(decision.providerChanged).toBe(false);
    });

    it('reconstructs and drops the session id when the provider differs', () => {
        const decision = resolveContinuationMode({
            binding: binding(),
            requestedProvider: 'codex',
        });

        expect(decision.mode).toBe('reconstructed');
        expect(decision.provider).toBe('codex');
        expect(decision.resumeSessionId).toBeUndefined();
        expect(decision.providerChanged).toBe(true);
    });

    it('reconstructs when the binding has no session id yet', () => {
        const decision = resolveContinuationMode({
            binding: binding({ sessionId: undefined }),
        });

        expect(decision.mode).toBe('reconstructed');
        expect(decision.provider).toBe('copilot');
        expect(decision.resumeSessionId).toBeUndefined();
        expect(decision.providerChanged).toBe(false);
    });

    it('honours a strict stopped-chat resume for the same provider', () => {
        const decision = resolveContinuationMode({
            binding: binding(),
            requestedProvider: 'copilot',
            strictResumeSessionId: 'copilot-session-1',
        });

        expect(decision.mode).toBe('native-resume');
        expect(decision.resumeSessionId).toBe('copilot-session-1');
        expect(decision.strictResume).toBe(true);
    });

    it('ignores a strict resume target when the provider differs', () => {
        // A stopped Copilot chat continued through Codex rebuilds from
        // canonical history; the Copilot session id must not travel with it,
        // and the turn must not be judged as a failed strict resume.
        const decision = resolveContinuationMode({
            binding: binding(),
            requestedProvider: 'codex',
            strictResumeSessionId: 'copilot-session-1',
        });

        expect(decision.mode).toBe('reconstructed');
        expect(decision.resumeSessionId).toBeUndefined();
        expect(decision.strictResume).toBe(false);
    });

    it('reconstructs when switching back to a provider used earlier', () => {
        // The earlier Copilot session is missing the turns that happened on
        // Codex, so returning to Copilot starts a new session rather than
        // resuming the old one.
        const decision = resolveContinuationMode({
            binding: binding({ provider: 'codex', sessionId: 'codex-session-1', segmentId: 'seg-2' }),
            requestedProvider: 'copilot',
        });

        expect(decision.mode).toBe('reconstructed');
        expect(decision.provider).toBe('copilot');
        expect(decision.resumeSessionId).toBeUndefined();
    });

    it('resumes a legacy projection natively when the provider is unchanged', () => {
        const decision = resolveContinuationMode({
            binding: binding({ segmentId: 'legacy' }),
        });

        expect(decision.mode).toBe('native-resume');
        expect(decision.resumeSessionId).toBe('copilot-session-1');
    });
});
