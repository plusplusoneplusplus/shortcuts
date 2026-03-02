/**
 * Tests for unread-indicators integration in RepoChatTab.
 *
 * Validates that RepoChatTab imports useChatReadState, wires isUnread
 * to ChatSessionSidebar, calls markRead on session selection, and
 * calls markRead when SSE streaming completes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TAB_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'
);

describe('RepoChatTab — unread indicators integration', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TAB_PATH, 'utf-8');
    });

    describe('hook wiring', () => {
        it('imports useChatReadState from chat module', () => {
            expect(source).toContain("import { useChatReadState } from '../chat/useChatReadState'");
        });

        it('calls useChatReadState with workspaceId', () => {
            expect(source).toContain('useChatReadState(workspaceId)');
        });

        it('stores hook result as readState', () => {
            expect(source).toContain('const readState = useChatReadState(workspaceId)');
        });
    });

    describe('sidebar prop wiring', () => {
        it('passes readState.isUnread to ChatSessionSidebar', () => {
            expect(source).toContain('isUnread={readState.isUnread}');
        });
    });

    describe('markRead on session selection', () => {
        it('calls readState.markRead in handleSelectSession', () => {
            // Extract handleSelectSession callback body
            const selectIdx = source.indexOf('const handleSelectSession');
            expect(selectIdx).toBeGreaterThan(-1);
            const selectBlock = source.slice(selectIdx, selectIdx + 800);
            expect(selectBlock).toContain('readState.markRead(taskId, session.turnCount)');
        });

        it('looks up session turnCount from sessionsHook.sessions', () => {
            const selectIdx = source.indexOf('const handleSelectSession');
            const selectBlock = source.slice(selectIdx, selectIdx + 800);
            expect(selectBlock).toContain('sessionsHook.sessions.find(s => s.id === taskId)');
        });
    });

    describe('markRead on SSE completion', () => {
        it('calls readState.markRead in follow-up finish handler', () => {
            const followUpIdx = source.indexOf('waitForFollowUpCompletion');
            expect(followUpIdx).toBeGreaterThan(-1);
            const followUpBlock = source.slice(followUpIdx, followUpIdx + 1200);
            expect(followUpBlock).toContain('readState.markRead(');
        });

        it('calls readState.markRead in SSE effect finish handler', () => {
            // The second finish function is in the useEffect for SSE reconnect
            const sseEffectMatch = source.indexOf('const finish = () => {');
            expect(sseEffectMatch).toBeGreaterThan(-1);
            // Find the second occurrence
            const secondFinish = source.indexOf('const finish = () => {', sseEffectMatch + 1);
            expect(secondFinish).toBeGreaterThan(-1);
            const finishBlock = source.slice(secondFinish, secondFinish + 500);
            expect(finishBlock).toContain('readState.markRead(');
        });

        it('passes updated turn count from fetched data to markRead', () => {
            // Both finish handlers should derive turn count from getConversationTurns
            expect(source).toContain('readState.markRead(ownerChatTaskId, turns.length)');
            expect(source).toContain('readState.markRead(chatTaskId, turns.length)');
        });
    });
});
