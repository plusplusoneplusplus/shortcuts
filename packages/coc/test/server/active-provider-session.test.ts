/**
 * Unit tests for the authoritative provider/native-session binding.
 *
 * The invariant under test: a provider and a native session id are only ever
 * read and written together. Reading a provider from `metadata.provider` and a
 * session id from `sdkSessionId` independently is what lets a new provider
 * inherit the previous provider's session.
 */

import { describe, it, expect } from 'vitest';
import type { ActiveProviderSession } from '@plusplusoneplusplus/forge';
import {
    LEGACY_SEGMENT_ID,
    readActiveProviderSession,
    resolveActiveProvider,
    resolveActiveSessionId,
    advanceActiveProviderSession,
    activeProviderSessionUpdate,
} from '../../src/server/processes/active-provider-session';

const bound: ActiveProviderSession = {
    provider: 'codex',
    sessionId: 'codex-1',
    segmentId: 'seg-a',
    firstTurnIndex: 6,
    boundAt: '2026-09-19T00:00:00.000Z',
};

const at = new Date('2026-09-19T12:00:00.000Z');
const mint = (id: string) => () => id;

describe('readActiveProviderSession', () => {
    it('returns the stored binding when present', () => {
        expect(readActiveProviderSession({ activeProviderSession: bound })).toEqual(bound);
    });

    it('ignores the legacy fields when a binding exists', () => {
        const resolved = readActiveProviderSession({
            activeProviderSession: bound,
            sdkSessionId: 'copilot-stale',
            metadata: { provider: 'copilot' },
        });
        expect(resolved.provider).toBe('codex');
        expect(resolved.sessionId).toBe('codex-1');
    });

    it('projects a pre-binding process from metadata.provider and sdkSessionId', () => {
        expect(readActiveProviderSession({
            sdkSessionId: 'claude-1',
            metadata: { provider: 'claude' },
        })).toEqual({
            provider: 'claude',
            sessionId: 'claude-1',
            segmentId: LEGACY_SEGMENT_ID,
            firstTurnIndex: 0,
        });
    });

    it('defaults to copilot for a process with no provider metadata', () => {
        expect(resolveActiveProvider({ sdkSessionId: 's-1' })).toBe('copilot');
    });

    it('does not treat an unknown stored provider as authoritative', () => {
        const resolved = readActiveProviderSession({
            activeProviderSession: { ...bound, provider: 'gemini' as never },
            metadata: { provider: 'opencode' },
        });
        expect(resolved.provider).toBe('opencode');
    });

    it('reports no session id when neither binding nor legacy field has one', () => {
        expect(resolveActiveSessionId({ metadata: { provider: 'opencode' } })).toBeUndefined();
    });
});

describe('advanceActiveProviderSession', () => {
    it('keeps the segment when the same provider reports the same session', () => {
        const result = advanceActiveProviderSession(bound, {
            provider: 'codex',
            sessionId: 'codex-1',
            turnIndex: 10,
            now: at,
        });
        expect(result.startedNewSegment).toBe(false);
        expect(result.binding).toEqual(bound);
    });

    it('starts a new segment when the provider changes', () => {
        const result = advanceActiveProviderSession(bound, {
            provider: 'claude',
            sessionId: 'claude-1',
            turnIndex: 10,
            now: at,
            newSegmentId: mint('seg-b'),
        });
        expect(result.startedNewSegment).toBe(true);
        expect(result.binding).toEqual({
            provider: 'claude',
            sessionId: 'claude-1',
            segmentId: 'seg-b',
            firstTurnIndex: 10,
            boundAt: at.toISOString(),
        });
    });

    it('starts a new segment when the same provider opens a fresh session', () => {
        const result = advanceActiveProviderSession(bound, {
            provider: 'codex',
            sessionId: 'codex-2',
            turnIndex: 12,
            now: at,
            newSegmentId: mint('seg-c'),
        });
        expect(result.startedNewSegment).toBe(true);
        expect(result.binding.segmentId).toBe('seg-c');
        expect(result.binding.firstTurnIndex).toBe(12);
    });

    it('never resumes an earlier segment when switching back to a provider', () => {
        const first = advanceActiveProviderSession(undefined, {
            provider: 'copilot', sessionId: 'copilot-1', turnIndex: 0, now: at, newSegmentId: mint('seg-1'),
        });
        const second = advanceActiveProviderSession(first.binding, {
            provider: 'codex', sessionId: 'codex-1', turnIndex: 2, now: at, newSegmentId: mint('seg-2'),
        });
        const third = advanceActiveProviderSession(second.binding, {
            provider: 'copilot', sessionId: 'copilot-2', turnIndex: 4, now: at, newSegmentId: mint('seg-3'),
        });

        expect(third.binding.sessionId).toBe('copilot-2');
        expect(third.binding.segmentId).toBe('seg-3');
        expect(third.startedNewSegment).toBe(true);
    });

    it('materializes a legacy projection without reporting a provider boundary', () => {
        const legacy = readActiveProviderSession({
            sdkSessionId: 'copilot-1',
            metadata: { provider: 'copilot' },
        });
        const result = advanceActiveProviderSession(legacy, {
            provider: 'copilot',
            sessionId: 'copilot-1',
            turnIndex: 8,
            now: at,
            newSegmentId: mint('seg-real'),
        });

        expect(result.startedNewSegment).toBe(false);
        expect(result.binding.segmentId).toBe('seg-real');
        // The whole legacy conversation belongs to that first segment.
        expect(result.binding.firstTurnIndex).toBe(0);
    });

    it('fills in the session id when the segment was opened without one', () => {
        const pending: ActiveProviderSession = {
            provider: 'claude', segmentId: 'seg-open', firstTurnIndex: 3,
        };
        const result = advanceActiveProviderSession(pending, {
            provider: 'claude', sessionId: 'claude-9', turnIndex: 5, now: at,
        });
        expect(result.startedNewSegment).toBe(false);
        expect(result.binding).toEqual({ ...pending, sessionId: 'claude-9' });
    });

    it('mints distinct segment ids by default', () => {
        const a = advanceActiveProviderSession(undefined, { provider: 'codex', sessionId: 's', turnIndex: 0 });
        const b = advanceActiveProviderSession(undefined, { provider: 'codex', sessionId: 's', turnIndex: 0 });
        expect(a.binding.segmentId).not.toBe(b.binding.segmentId);
    });
});

describe('activeProviderSessionUpdate', () => {
    it('writes the binding and its compatibility projection in one update', () => {
        expect(activeProviderSessionUpdate(bound)).toEqual({
            activeProviderSession: bound,
            sdkSessionId: 'codex-1',
        });
    });

    it('cannot pair a new provider with a stale session id', () => {
        const next = advanceActiveProviderSession(bound, {
            provider: 'claude', sessionId: 'claude-1', turnIndex: 7, now: at,
        }).binding;
        const update = activeProviderSessionUpdate(next);

        expect(update.activeProviderSession?.provider).toBe('claude');
        expect(update.sdkSessionId).toBe('claude-1');
        expect(update.sdkSessionId).toBe(update.activeProviderSession?.sessionId);
    });
});
