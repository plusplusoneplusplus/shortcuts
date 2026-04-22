/**
 * Tests for CreateWorkItemDialog fromChat support.
 *
 * Note: The "Create Work Item from Chat" button in ChatHeader and its
 * ChatDetail integration were removed during a refactor.
 * Only the CreateWorkItemDialog fromChat support tests remain.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const CREATE_WORK_ITEM_DIALOG_SRC_PATH = path.join(REACT_SRC, 'features', 'work-items', 'CreateWorkItemDialog.tsx');

describe('CreateWorkItemDialog — fromChat support', () => {
    let dialogSrc: string;

    beforeAll(() => {
        dialogSrc = fs.readFileSync(CREATE_WORK_ITEM_DIALOG_SRC_PATH, 'utf-8');
    });

    it('accepts fromChatId prop', () => {
        expect(dialogSrc).toContain('fromChatId?: string');
    });

    it('calls from-chat endpoint when fromChatId is provided', () => {
        expect(dialogSrc).toContain('/from-chat');
        expect(dialogSrc).toContain('processId: fromChatId');
    });

    it('shows chat session indicator for fromChat mode', () => {
        expect(dialogSrc).toContain('Creating from chat session');
    });
});
