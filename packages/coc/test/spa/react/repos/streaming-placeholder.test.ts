/**
 * Behavioral coverage for the empty-assistant streaming-placeholder decision
 * (AC-02). ConversationArea pulls in the full conversation render tree, so the
 * sibling ConversationArea-compacting suite asserts only that the component
 * delegates to this helper — the actual behavior (notably "absence of the
 * normal assistant placeholder during compaction") is verified here against the
 * pure function.
 */

import { describe, it, expect } from 'vitest';
import { shouldInjectStreamingPlaceholder } from '../../../../src/server/spa/client/react/features/chat/streaming-placeholder';

describe('shouldInjectStreamingPlaceholder', () => {
    const base = { status: 'running', hasStreaming: false, turnCount: 1, isCompacting: false };

    it('injects the placeholder for a running task that has turns and no live stream', () => {
        expect(shouldInjectStreamingPlaceholder(base)).toBe(true);
    });

    it('suppresses the placeholder while compacting (AC-02)', () => {
        // AC-01 marks the process `running` during compaction with no assistant
        // generation; the synthetic CompactionBubble is the only in-progress
        // indicator, so the empty streaming placeholder must NOT be injected.
        expect(shouldInjectStreamingPlaceholder({ ...base, isCompacting: true })).toBe(false);
    });

    it('does not inject when a live streaming turn already exists', () => {
        expect(shouldInjectStreamingPlaceholder({ ...base, hasStreaming: true })).toBe(false);
    });

    it('does not inject when there are no turns yet', () => {
        expect(shouldInjectStreamingPlaceholder({ ...base, turnCount: 0 })).toBe(false);
    });

    it('does not inject for non-running statuses', () => {
        for (const status of ['queued', 'completed', 'failed', 'cancelled', 'cancelling', undefined, null]) {
            expect(shouldInjectStreamingPlaceholder({ ...base, status })).toBe(false);
        }
    });

    it('compacting wins even if the task is running with turns and no stream', () => {
        // Same inputs that would otherwise inject — only isCompacting flips it.
        expect(shouldInjectStreamingPlaceholder({ status: 'running', hasStreaming: false, turnCount: 3, isCompacting: false })).toBe(true);
        expect(shouldInjectStreamingPlaceholder({ status: 'running', hasStreaming: false, turnCount: 3, isCompacting: true })).toBe(false);
    });
});
