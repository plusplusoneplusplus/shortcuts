/**
 * Regression test: ConversationArea sorts turns by turnIndex before rendering.
 *
 * Without sorting, turns appear in raw array order. When a race condition causes
 * turns to be stored out of order (e.g., user turn appended before the final
 * assistant turn), the UI would render them in the wrong sequence.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos'
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
        // Using turnIndex as key ensures React reconciles correctly even when order changes
        expect(CONVERSATION_AREA_SOURCE).toMatch(/key=\{turn\.turnIndex/);
    });
});
