/**
 * Wiring tests for the in-progress `/compact` bubble in ConversationArea (AC-02).
 *
 * ConversationArea pulls in the full conversation render tree (ConversationTurnBubble
 * et al.), so — like the sibling sort-order / overflow suites — these assert the
 * source wiring rather than mounting the whole tree. The bubble itself is render-
 * tested in CompactionBubble.test.tsx and the lifecycle in useSendMessage-compact.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat'
);

const CONVERSATION_AREA_SOURCE = fs.readFileSync(path.join(CHAT_DIR, 'ConversationArea.tsx'), 'utf-8');
const CHAT_DETAIL_SOURCE = fs.readFileSync(path.join(CHAT_DIR, 'ChatDetail.tsx'), 'utf-8');
const USE_SEND_MESSAGE_SOURCE = fs.readFileSync(path.join(CHAT_DIR, 'hooks', 'useSendMessage.ts'), 'utf-8');

describe('ConversationArea: compacting bubble wiring', () => {
    it('accepts an isCompacting prop', () => {
        expect(CONVERSATION_AREA_SOURCE).toContain('isCompacting?:');
    });

    it('renders the CompactionBubble while compacting', () => {
        expect(CONVERSATION_AREA_SOURCE).toContain("import { CompactionBubble } from './CompactionBubble'");
        expect(CONVERSATION_AREA_SOURCE).toMatch(/isCompacting && \(\s*<CompactionBubble/);
    });

    it('suppresses the empty assistant streaming placeholder while compacting', () => {
        // The placeholder is injected when a running task has no live streaming
        // turn; during compaction the status is `running` with no generation, so
        // the condition must also require !isCompacting.
        expect(CONVERSATION_AREA_SOURCE).toMatch(/!hasStreaming && turns\.length > 0 && !isCompacting/);
    });
});

describe('ChatDetail: compacting state wiring', () => {
    it('derives isCompacting from the persisted compaction state or the local flag', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("persistedCompaction?.state === 'running'");
        expect(CHAT_DETAIL_SOURCE).toMatch(/const isCompacting = compacting \|\| /);
    });

    it('passes isCompacting and compactInstructions to ConversationArea', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('isCompacting={isCompacting}');
        expect(CHAT_DETAIL_SOURCE).toContain('compactInstructions={compactInstructions}');
    });

    it('feeds the compaction lifecycle into useSendMessage', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('setCompacting: handleCompactingChange');
    });

    it('disables the composer while compacting', () => {
        expect(CHAT_DETAIL_SOURCE).toMatch(/const inputDisabled = [^;]*isCompacting/);
    });
});

describe('useSendMessage: compaction in-flight guard', () => {
    it('keeps a synchronous in-flight ref to block re-entry', () => {
        expect(USE_SEND_MESSAGE_SOURCE).toContain('compactingRef');
        expect(USE_SEND_MESSAGE_SOURCE).toMatch(/if \(compactingRef\.current\) return;/);
    });

    it('toggles the in-flight ref + setCompacting around the compact POST', () => {
        expect(USE_SEND_MESSAGE_SOURCE).toContain('compactingRef.current = true');
        expect(USE_SEND_MESSAGE_SOURCE).toContain('compactingRef.current = false');
        expect(USE_SEND_MESSAGE_SOURCE).toContain('setCompacting?.(true, customInstructions)');
        expect(USE_SEND_MESSAGE_SOURCE).toContain('setCompacting?.(false)');
    });
});
