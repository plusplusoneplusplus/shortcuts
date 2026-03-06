/**
 * Tests for RepoChatTab per-chat input state:
 *  - Per-chat input drafts via useRef<Map<string | null, string>>
 *  - inputDisabled derived from sending, isStreaming, queued, running
 *  - Slash-command menu dismiss on session switch
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
    'utf-8',
);

describe('RepoChatTab per-chat input state: inputDrafts ref', () => {
    it('declares inputDrafts as a useRef<Map<string | null, string>>', () => {
        expect(SRC).toContain('const inputDrafts = useRef<Map<string | null, string>>(new Map())');
    });

    it('persists draft in start-screen textarea onChange', () => {
        // The start-screen textarea onChange should write to inputDrafts
        expect(SRC).toContain('inputDrafts.current.set(selectedTaskId ?? null, e.target.value)');
    });

    it('persists draft in follow-up textarea onChange', () => {
        // Both textareas should persist drafts — the pattern appears at least twice
        const matches = SRC.match(/inputDrafts\.current\.set\(selectedTaskId \?\? null, e\.target\.value\)/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('restores draft when selecting a session', () => {
        expect(SRC).toContain("setInputValue(inputDrafts.current.get(taskId) ?? '')");
    });

    it('clears null-key draft on new chat', () => {
        expect(SRC).toContain('inputDrafts.current.delete(null)');
    });

    it('clears draft after starting a chat', () => {
        // handleStartChat clears draft for selectedTaskId
        expect(SRC).toContain('inputDrafts.current.delete(selectedTaskId ?? null)');
    });

    it('clears draft after sending follow-up', () => {
        // sendFollowUp also clears draft — pattern appears at least twice (startChat + followUp)
        const matches = SRC.match(/inputDrafts\.current\.delete\(selectedTaskId \?\? null\)/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});

describe('RepoChatTab per-chat input state: inputDisabled', () => {
    it('derives inputDisabled from sending, isStreaming, and queued (not running)', () => {
        expect(SRC).toContain(
            "const inputDisabled = sending || isStreaming || task?.status === 'queued'"
        );
        // 'running' should NOT be in the inputDisabled expression
        expect(SRC).not.toMatch(
            /const inputDisabled = sending \|\| isStreaming \|\| task\?\.status === 'queued' \|\| task\?\.status === 'running'/
        );
    });

    it('uses inputDisabled on follow-up textarea disabled prop', () => {
        expect(SRC).toContain('disabled={inputDisabled}');
    });

    it('uses inputDisabled on follow-up send button', () => {
        expect(SRC).toContain('disabled={inputDisabled || !inputValue.trim()}');
    });

    it('uses inputDisabled on SuggestionChips', () => {
        expect(SRC).toContain('disabled={inputDisabled || sessionExpired}');
    });

    it('still has taskFinished for header resume logic', () => {
        expect(SRC).toContain("task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled'");
    });
});

describe('RepoChatTab per-chat input state: slash-command menu dismiss', () => {
    it('dismisses slash menu in handleSelectSession', () => {
        // The handleSelectSession callback should call slashCommands.dismissMenu()
        const selectSessionBlock = SRC.slice(
            SRC.indexOf('const handleSelectSession'),
            SRC.indexOf('const handleNewChat'),
        );
        expect(selectSessionBlock).toContain('slashCommands.dismissMenu()');
    });

    it('dismisses slash menu in handleNewChat', () => {
        const newChatBlock = SRC.slice(
            SRC.indexOf('const handleNewChat'),
            SRC.indexOf('const localTriggerRef') || SRC.indexOf('// Trigger new chat'),
        );
        expect(newChatBlock).toContain('slashCommands.dismissMenu()');
    });
});
