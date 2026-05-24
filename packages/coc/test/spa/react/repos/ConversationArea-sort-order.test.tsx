/**
 * Regression test: ConversationArea sorts turns by turnIndex before rendering.
 *
 * Without sorting, turns appear in raw array order. When a race condition causes
 * turns to be stored out of order (e.g., user turn appended before the final
 * assistant turn), the UI would render them in the wrong sequence.
 *
 * Turns without turnIndex must sort to the END (they are the newest, e.g.
 * streaming placeholders or synthetic follow-up turns), not to position 0.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat'
);

const CONVERSATION_AREA_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ConversationArea.tsx'), 'utf-8');

describe('ConversationArea: turn ordering', () => {
    it('sorts renderTurns by turnIndex before rendering', () => {
        // The source must contain a sort by turnIndex to handle storage order anomalies
        expect(CONVERSATION_AREA_SOURCE).toContain('sortedTurns');
        expect(CONVERSATION_AREA_SOURCE).toContain('.sort(');
        expect(CONVERSATION_AREA_SOURCE).toContain('turnIndex');
    });

    it('uses turnIndex as React key instead of array index', () => {
        // Using turnIndex as key ensures React reconciles correctly even when order changes.
        // The key may be passed via a local variable (e.g. `const idx = turn.turnIndex ?? i`)
        // and then used as `key={idx}`, which is functionally equivalent.
        const usesDirectKey = /key=\{turn\.turnIndex/.test(CONVERSATION_AREA_SOURCE);
        const usesIdxVariable =
            /const idx = turn\.turnIndex/.test(CONVERSATION_AREA_SOURCE) &&
            /key=\{idx\}/.test(CONVERSATION_AREA_SOURCE);
        expect(usesDirectKey || usesIdxVariable).toBe(true);
    });

    it('sorts turns without turnIndex to the end, not the beginning', () => {
        // The old ?? 0 fallback moved turns without turnIndex to position 0;
        // the fix uses null-aware comparison to push them to the end
        expect(CONVERSATION_AREA_SOURCE).not.toMatch(/turnIndex\s*\?\?\s*0/);
        // Verify null checks exist for proper end-sort behavior
        expect(CONVERSATION_AREA_SOURCE).toContain('ai == null');
        expect(CONVERSATION_AREA_SOURCE).toContain('bi == null');
    });

    it('assigns turnIndex to the streaming placeholder appended for running tasks', () => {
        // When a running task has no streaming turn, a placeholder is appended;
        // it must have a turnIndex to avoid sort instability
        expect(CONVERSATION_AREA_SOURCE).toContain('nextTurnIndex');
    });
});

describe('ConversationArea: process error banner', () => {
    it('accepts a processError prop in ConversationAreaProps', () => {
        expect(CONVERSATION_AREA_SOURCE).toContain('processError?:');
    });

    it('renders a process-error-banner when processError is provided', () => {
        expect(CONVERSATION_AREA_SOURCE).toContain('process-error-banner');
    });

    it('shows the error banner in the zero-turns case when processError is set', () => {
        // The banner should replace the generic "No conversation data available." message
        // when a processError is provided (failed task with no turns).
        expect(CONVERSATION_AREA_SOURCE).toContain('processError ?');
        // Generic fallback must still exist for the no-error zero-turns case
        expect(CONVERSATION_AREA_SOURCE).toContain('No conversation data available.');
    });

    it('shows the error banner after turns when the task failed with an error', () => {
        // The banner is also rendered inside the turns branch for failed tasks
        // that produced some turns before failing.
        expect(CONVERSATION_AREA_SOURCE).toContain("task?.status === 'failed'");
    });

    it('labels the banner with "Task failed" heading', () => {
        expect(CONVERSATION_AREA_SOURCE).toContain('Task failed');
    });

    it('passes processError from ChatDetail to ConversationArea', () => {
        const chatDetailSource = fs.readFileSync(
            path.join(REPOS_DIR, 'ChatDetail.tsx'), 'utf-8'
        );
        expect(chatDetailSource).toContain('processError={processDetails?.error');
    });
});

